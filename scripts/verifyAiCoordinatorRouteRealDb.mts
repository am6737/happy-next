import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { createStructuredModelHandler } from '../packages/happy-cli/src/daemon/structuredModel';
import { AiCoordinatorDecisionSchema, type AiCoordinatorDecision } from '../packages/happy-wire/src/aiCoordinator';

// Real PostgreSQL, HTTP message route and configured pure HTTP inference.
// RPC transport/provider discovery are in-process fixtures; queued executions
// are never dispatched. No user repo, GitHub or external messaging writes.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const accounts: string[] = [];
const handler = createStructuredModelHandler();
const savedKey = process.env.OPENAI_API_KEY;
// Exercise the CLI pure-inference gateway even if hosted configuration exists.
delete process.env.OPENAI_API_KEY;
let expectedIntent = ''; let modelCalls = 0;
let lastDecision: AiCoordinatorDecision | undefined;
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `coordinator-route-${tag}-${i}` } })).id);
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId: accounts[0], metadata: '{}', active: true } });
    const socket: any = { connected: true, timeout: () => socket, emitWithAck: async (_event: string, request: any) => {
        if (request.method.endsWith(':bash')) return { success: true, stdout: 'codex:true\nclaude:false\ngemini:false\n' };
        assert.ok(request.method.endsWith(':ai-structured-model'));
        const result = await handler.handle(request.params);
        assert.equal(result.success, true, 'Actual inference unavailable');
        if (!result.success) throw new Error('PURE_INFERENCE_FAILED');
        const decision = AiCoordinatorDecisionSchema.parse(JSON.parse(result.text));
        assert.equal(decision.intent, expectedIntent, 'Route inference did not choose expected action');
        lastDecision = decision;
        modelCalls++;
        return result;
    } };
    const listeners = getOrCreateUserRpcListeners(accounts[0]);
    for (const method of ['bash', 'orchestrator-dispatch', 'ai-structured-model']) listeners.set(`${machineId}:${method}`, socket);
    const agent = await db.aiAgent.create({ data: { accountId: accounts[0], name: 'Alice', role: 'Coordinator', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', model: 'default', instructions: '', workingDirectory: '', permissionMode: 'read_only', allowDelegation: true } } });
    // Deliberately no Team membership: context must include this direct Agent.
    const conversation = await db.aiConversation.create({ data: { accountId: accounts[0], agentId: agent.id, scopeKey: tag, kind: 'direct', title: 'Owned route acceptance' } });
    aiTeamRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const send = async (body: unknown, accountId = accounts[0]) => {
        const response = await fetch(`${base}/v1/ai-team/conversations/${conversation.id}/messages`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-account': accountId },
            body: JSON.stringify(body), signal: AbortSignal.timeout(65_000) });
        return { status: response.status, body: await response.json() as any };
    };
    expectedIntent = 'chat';
    const chat = await send({ text: '你好，今天只闲聊，请不要创建或修改任务。', clientMessageId: `${tag}-chat` });
    assert.equal(chat.status, 200); assert.equal(chat.body.kind, 'chat');
    assert.equal(await db.aiWorkItem.count({ where: { accountId: accounts[0] } }), 0);
    expectedIntent = 'clarify';
    const clarify = await send({ text: '我想做一个应用，但没有确定需求，请先提问并给出可选方向。', clientMessageId: `${tag}-clarify` });
    assert.equal(clarify.status, 200); assert.equal(clarify.body.kind, 'clarify');
    const modelClarificationOptions = lastDecision?.intent === 'clarify' ? lastDecision.options : null;
    const persistedClarification = await db.aiClarification.findUniqueOrThrow({ where: { id: clarify.body.clarificationId } });
    assert.equal(persistedClarification.status, 'pending');
    const pendingResponse = await fetch(`${base}/v1/ai-team/conversations/${conversation.id}/clarifications?status=pending`, {
        headers: { 'x-fixture-account': accounts[0] }, signal: AbortSignal.timeout(15_000) });
    assert.equal(pendingResponse.status, 200);
    const pending = await pendingResponse.json() as any;
    const refreshedOptions = pending.items.find((item: any) => item.id === clarify.body.clarificationId)?.options;
    await db.aiClarification.update({ where: { id: clarify.body.clarificationId }, data: { status: 'resolved' } });
    expectedIntent = 'create_task';
    const newBody = { text: '独立新需求：请让 Alice 给计算器添加整数相加功能及测试，创建一次任务，不修改已有任务。', clientMessageId: `${tag}-create` };
    const created = await send(newBody);
    assert.equal(created.status, 201); assert.ok(created.body.workItemId);
    const work = await db.aiWorkItem.findUniqueOrThrow({ where: { id: created.body.workItemId } });
    assert.equal(work.assigneeId, agent.id); assert.equal(work.conversationId, conversation.id);
    assert.equal(lastDecision?.intent, 'create_task');
    if (lastDecision?.intent === 'create_task') {
        assert.equal(work.title, lastDecision.title, 'Message route discarded Coordinator task title');
        assert.equal(work.summary, lastDecision.requirements, 'Message route discarded Coordinator requirements');
    }
    const replay = await send(newBody); assert.equal(replay.status, 200); assert.deepEqual(replay.body, created.body);
    assert.equal(await db.aiWorkItem.count({ where: { accountId: accounts[0] } }), 1);
    await db.orchestratorTask.update({ where: { id: work.orchestratorTaskId }, data: { status: 'completed' } });
    await db.orchestratorExecution.create({ data: { runId: work.orchestratorRunId, taskId: work.orchestratorTaskId,
        machineId, provider: 'codex', childSessionId: `fixture-${tag}`, attempt: 1, dispatchToken: randomUUID(), status: 'completed' } });
    expectedIntent = 'update_task';
    const update = await send({ text: `继续已有任务 ${work.id}，追加验收要求：整数相加支持负数。只修改该任务，不新建。`, clientMessageId: `${tag}-update` });
    assert.equal(update.status, 200); assert.equal(update.body.kind, 'update_task'); assert.equal(update.body.targetWorkItemId, work.id);
    assert.equal(await db.aiWorkItem.count({ where: { accountId: accounts[0] } }), 1);
    expectedIntent = 'delegate';
    const proposal = await send({ text: `请对已有任务 ${work.id} 提出委派方案，让 Alice 负责相加实现。输出 delegate 提议，不更新任务或声称已经执行。`, clientMessageId: `${tag}-delegate` });
    assert.equal(proposal.status, 409); assert.match(proposal.body.error, /Leader execution token/);
    assert.equal(await db.orchestratorTask.count({ where: { runId: work.orchestratorRunId } }), 1);
    assert.equal((await send(newBody, accounts[1])).status, 404);
    assert.equal(modelCalls, 5, 'Fallback or duplicate model call cannot count as complete Coordinator coverage');
    console.log('REAL_DB_HTTP_ACTUAL_COORDINATOR_FIVE_ACTIONS_DIRECT_AGENT_REPLAY_AND_DELEGATION_GATE_OK');
    assert.deepEqual(clarify.body.options, modelClarificationOptions,
        'Message route discarded Coordinator clarification choices');
    assert.deepEqual((persistedClarification as any).options, modelClarificationOptions,
        'Coordinator clarification choices were not durable');
    assert.deepEqual(refreshedOptions, modelClarificationOptions,
        'Refreshed clarification API discarded Coordinator choices');
    console.log('REAL_DB_HTTP_COORDINATOR_CLARIFICATION_OPTIONS_DURABLE_AND_REFRESHABLE_OK');
} finally {
    handler.cancelAll(); await app.close();
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    for (const id of accounts) getOrCreateUserRpcListeners(id).clear();
    await db.aiInboundRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.machine.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `coordinator-route-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
