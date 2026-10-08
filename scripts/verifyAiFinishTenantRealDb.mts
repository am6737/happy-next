import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';

// An ordinary orchestrator submit accepts arbitrary run metadata. Exercise its
// finish consumer with owned accounts only; foreign metadata must not write
// another account's conversation even with a valid own execution token.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const tag = randomUUID(); const accounts: string[] = []; const runs: string[] = [];
const app = fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `ai-team-finish-tenant-${tag}-${i}` } })).id);
    const settings = { instructions: '', engine: 'codex', model: 'default', workingDirectory: '', permissionMode: 'read_only', allowDelegation: false };
    const agent = await db.aiAgent.create({ data: { accountId: accounts[1], name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings } });
    const conversation = await db.aiConversation.create({ data: { accountId: accounts[1], agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const ownAgent = await db.aiAgent.create({ data: { accountId: accounts[0], name: `${tag}-own`, role: 'Fixture', description: '', emoji: '', instructions: '', settings } });
    const unrelatedAgent = await db.aiAgent.create({ data: { accountId: accounts[0], name: `${tag}-unrelated`, role: 'Fixture', description: '', emoji: '', instructions: '', settings } });
    const ownConversation = await db.aiConversation.create({ data: { accountId: accounts[0], agentId: ownAgent.id, scopeKey: `${tag}-own`, kind: 'direct', title: tag } });
    orchestratorRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    async function finish(conversationId: string, agentId: string) {
        const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag, status: 'running',
            metadata: { coordinatorChat: true, conversationId, aiAgentId: agentId },
            tasks: { create: { seq: 1, taskKey: 'metadata-fixture', provider: 'codex', prompt: '', status: 'running' } },
        }, include: { tasks: true } }); runs.push(run.id);
        const dispatchToken = randomUUID();
        const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id, machineId: tag, provider: 'codex', status: 'running', dispatchToken } });
        const send = (token: string) => fetch(`${base}/v1/orchestrator/executions/${execution.id}/finish`, {
            method: 'POST', signal: AbortSignal.timeout(10000),
            headers: { 'content-type': 'application/json', 'x-fixture-account': accounts[0] },
            body: JSON.stringify({ dispatchToken: token, status: 'completed', exitCode: 0, finalResponse: 'Owned security fixture output' }),
        });
        const response = await send(dispatchToken);
        assert.ok([200, 400, 403, 409].includes(response.status), 'Unexpected finish response');
        return { status: response.status, send, dispatchToken };
    }
    const valid = await finish(ownConversation.id, ownAgent.id);
    assert.equal(valid.status, 200, 'Legitimate coordinator response was rejected');
    assert.equal(await db.aiMessage.count({ where: { conversationId: ownConversation.id } }), 1, 'Legitimate response was not persisted exactly once');
    assert.equal((await valid.send(valid.dispatchToken)).status, 200);
    assert.equal((await valid.send(randomUUID())).status, 409);
    assert.equal(await db.aiMessage.count({ where: { conversationId: ownConversation.id } }), 1, 'Duplicate finish duplicated a legitimate response');
    console.log('REAL_DB_HTTP_LEGITIMATE_FINAL_RESPONSE_AND_TOKEN_IDEMPOTENCY_OK');
    const failures: string[] = [];
    for (const item of [
        { conversationId: conversation.id, agentId: agent.id, message: 'Own execution wrote finalResponse into another account conversation' },
        { conversationId: ownConversation.id, agentId: agent.id, message: 'Own conversation accepted another account agent attribution' },
        { conversationId: ownConversation.id, agentId: unrelatedAgent.id, message: 'Direct conversation accepted an unrelated agent attribution' },
    ]) {
        const before = await db.aiMessage.count({ where: { conversationId: item.conversationId } });
        await finish(item.conversationId, item.agentId);
        if (await db.aiMessage.count({ where: { conversationId: item.conversationId } }) !== before) failures.push(item.message);
    }
    assert.equal(failures.length, 0, failures.join('; '));
    console.log('REAL_DB_HTTP_FINISH_FOREIGN_COORDINATOR_METADATA_REJECTED_OK');
} finally {
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `ai-team-finish-tenant-${tag}-` } } });
    await db.$disconnect(); redis.disconnect();
}
