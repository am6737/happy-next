import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiDelegationRoutes } from '../packages/happy-server/sources/app/api/routes/aiDelegationRoutes';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';

// Real PostgreSQL transactions and authenticated loopback HTTP; execution and
// members are owned fixtures. Does not start models or write external systems.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const tag = randomUUID(); const accounts: string[] = []; const runs: string[] = [];
const app = fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
app.decorate('authenticate', async (request: any, reply: any) => {
    const accountId = request.headers['x-fixture-account'];
    if (!accounts.includes(accountId)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = accountId;
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `ai-team-delegation-${tag}-${i}` } })).id);
    const settings = { instructions: '', engine: 'codex', model: 'default', workingDirectory: '', permissionMode: 'read_only', allowDelegation: false };
    const agents = [];
    for (const name of ['leader', 'alpha', 'beta', 'disabled']) agents.push(await db.aiAgent.create({ data: {
        accountId: accounts[0], name, role: 'Fixture', description: 'Owned delegation test', emoji: '', instructions: '',
        enabled: name !== 'disabled', settings: { ...settings, allowDelegation: name === 'leader' },
    } }));
    const outsider = await db.aiAgent.create({ data: { accountId: accounts[1], name: 'outsider', role: 'Fixture', description: '', emoji: '', instructions: '', settings } });
    const team = await db.aiTeam.create({ data: { accountId: accounts[0], name: tag, description: '', emoji: '', instructions: '', leaderId: agents[0].id,
        members: { create: agents.map((agent) => ({ agentId: agent.id })) } } });
    const conversation = await db.aiConversation.create({ data: { accountId: accounts[0], agentId: agents[0].id, teamId: team.id,
        scopeKey: tag, kind: 'group', title: 'Delegation fixture' } });
    const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag, status: 'running', tasks: { create: [
        { seq: 1, taskKey: 'leader', provider: 'codex', prompt: '', status: 'running', permissionMode: 'read_only', assignedAgentId: agents[0].id, collaborationRole: 'leader_plan' },
        { seq: 2, taskKey: 'aggregate', provider: 'codex', prompt: '', status: 'queued', permissionMode: 'read_only', assignedAgentId: agents[0].id, collaborationRole: 'aggregate', dependsOnTaskKeys: ['leader'] },
    ] } }, include: { tasks: true } }); runs.push(run.id);
    const leader = run.tasks.find((task) => task.taskKey === 'leader')!;
    const aggregate = run.tasks.find((task) => task.taskKey === 'aggregate')!;
    await db.aiWorkItem.create({ data: { accountId: accounts[0], assigneeId: agents[0].id, teamId: team.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: aggregate.id, title: tag, summary: '', sourceType: 'execution', sourceLabel: 'Owned fixture', sourceResourceId: conversation.id } });
    const dispatchToken = randomUUID();
    const leaderExecution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: leader.id, machineId: tag, provider: 'codex', status: 'running', dispatchToken } });
    aiDelegationRoutes(app); orchestratorRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const send = async (body: unknown, accountId = accounts[0]) => fetch(`${base}/v1/ai-team/tasks/${leader.id}/delegations`, {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-fixture-account': accountId }, body: JSON.stringify(body),
    });
    const first = { dispatchToken, delegationKey: 'alpha', assignedAgentId: agents[1].id, title: 'Alpha', requirements: 'Read alpha', dependsOnTaskIds: [] };
    assert.equal((await send({ ...first, dispatchToken: randomUUID() })).status, 409, 'Unknown execution token accepted');
    assert.equal((await send(first, accounts[1])).status, 404, 'Cross-account leader accessed');
    assert.equal((await send({ ...first, assignedAgentId: outsider.id })).status, 403, 'Cross-account member delegated');
    assert.equal((await send({ ...first, assignedAgentId: agents[3].id })).status, 403, 'Disabled member delegated');
    assert.equal((await send({ ...first, dependsOnTaskIds: [leader.id] })).status, 409, 'Leader dependency cycle accepted');
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => send(first)));
    assert.ok(concurrent.every((response) => [200, 201, 503].includes(response.status)), 'Unexpected concurrent delegation response');
    const firstConfirmed = await send(first); assert.equal(firstConfirmed.status, 200);
    const firstResult: any = await firstConfirmed.json();
    assert.equal(await db.orchestratorTask.count({ where: { parentTaskId: leader.id, delegationKey: 'alpha' } }), 1);
    assert.equal((await send({ ...first, requirements: 'Different instructions' })).status, 409, 'Delegation key accepted changed requirements');
    const second = { ...first, delegationKey: 'beta', assignedAgentId: agents[2].id, title: 'Beta', dependsOnTaskIds: [firstResult.taskId] };
    assert.equal((await send(second)).status, 201);
    const dependencies = (await db.orchestratorTask.findUniqueOrThrow({ where: { id: aggregate.id } })).dependsOnTaskKeys;
    assert.deepEqual(new Set(dependencies), new Set(['leader', 'delegate:alpha', 'delegate:beta']), 'Aggregate does not wait for every member');
    const beta = await db.orchestratorTask.findFirstOrThrow({ where: { parentTaskId: leader.id, delegationKey: 'beta' } });
    assert.deepEqual(beta.dependsOnTaskKeys, ['delegate:alpha']);
    assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'running');
    console.log('REAL_DB_HTTP_DELEGATION_MEMBER_DAG_CONCURRENCY_AND_AGGREGATE_OK');
    const finished = await fetch(`${base}/v1/orchestrator/executions/${leaderExecution.id}/finish`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', 'x-fixture-account': accounts[0] },
        body: JSON.stringify({ dispatchToken, status: 'completed', exitCode: 0, finalResponse: 'Planning completed; members still pending.' }),
    });
    assert.equal(finished.status, 200, 'Leader finish failed');
    assert.equal((await db.orchestratorTask.findUniqueOrThrow({ where: { id: leader.id } })).status, 'completed');
    assert.equal((await db.orchestratorTask.findUniqueOrThrow({ where: { id: aggregate.id } })).status, 'queued');
    assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'running', 'Leader exit completed the overall team run');
    assert.equal((await send(first)).status, 200, 'Original execution token cannot recover idempotent response after completion');
    console.log('REAL_DB_HTTP_LEADER_FINISH_DOES_NOT_COMPLETE_TEAM_OK');
    assert.equal((await send({ ...first, dispatchToken: randomUUID() })).status, 409, 'Idempotent replay bypassed execution token');
    console.log('REAL_DB_HTTP_DELEGATION_REPLAY_TOKEN_FENCING_OK');
} finally {
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiTeam.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `ai-team-delegation-${tag}-` } } });
    await db.$disconnect(); redis.disconnect();
}
