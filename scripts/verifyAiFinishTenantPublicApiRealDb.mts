import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';

// Public HTTP submit and finish use real PostgreSQL. No scheduler, daemon, RPC,
// model, external network, or other account is involved in this fixture.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const tag = randomUUID();
const publicKeyPrefix = `ai-team-finish-public-${tag}-`;
const accounts: string[] = [];
const runs: string[] = [];
const machineId = `ai-team-finish-public-machine-${tag}`;
const app = fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
app.decorate('authenticate', async (request: any, reply: any) => {
    const accountId = request.headers['x-fixture-account'];
    if (!accounts.includes(accountId)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = accountId;
});

let cleanupCounts = { runs: 0, conversations: 0, agents: 0, machines: 0, accounts: 0 };
try {
    for (let i = 0; i < 2; i++) {
        accounts.push((await db.account.create({ data: { publicKey: `${publicKeyPrefix}${i}` } })).id);
    }
    const settings = { instructions: '', engine: 'codex', model: 'default', workingDirectory: '', permissionMode: 'read_only' };
    const foreignAgent = await db.aiAgent.create({ data: {
        accountId: accounts[1], name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings,
    } });
    const foreignConversation = await db.aiConversation.create({ data: {
        accountId: accounts[1], agentId: foreignAgent.id, scopeKey: tag, kind: 'direct', title: tag,
    } });
    await db.machine.create({ data: { id: machineId, accountId: accounts[0], metadata: '{}' } });

    orchestratorRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const metadata = { coordinatorChat: true, conversationId: foreignConversation.id, aiAgentId: foreignAgent.id,
        aiTeamId: 'untrusted-team', githubRepositoryId: '123456789' };
    const submit = (value: Record<string, unknown>, key: string) => fetch(`${base}/v1/orchestrator/submit`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'x-fixture-account': accounts[0] },
        body: JSON.stringify({ title: tag, mode: 'async', idempotencyKey: key, metadata: value,
            tasks: [{ taskKey: 'primary', provider: 'codex', prompt: 'Owned fixture only',
                target: { type: 'machine_id', machineId } }] }),
    });
    const malicious = await submit(metadata, `${tag}-malicious`);
    assert.equal(malicious.status, 400, 'Public submit accepted internal identity metadata');
    for (const [key, value] of Object.entries(metadata)) {
        assert.equal((await submit({ [key]: value }, `${tag}-${key}`)).status, 400, `Public submit accepted reserved metadata key ${key}`);
    }
    assert.equal(await db.orchestratorRun.count({ where: { accountId: accounts[0] } }), 0, 'Rejected metadata created a run');
    const submitted = await submit({ acceptanceFixture: tag }, `${tag}-legitimate`);
    const submitBody: any = await submitted.json();
    assert.equal(submitted.status, 200, 'Public submit rejected harmless metadata');
    const runId = submitBody?.data?.runId;
    assert.equal(typeof runId, 'string', 'Public submit did not return runId');
    runs.push(runId);
    const run = await db.orchestratorRun.findFirstOrThrow({ where: { id: runId, accountId: accounts[0] }, include: { tasks: true } });
    assert.deepEqual(run.metadata, { acceptanceFixture: tag }, 'Harmless metadata was not preserved');
    assert.equal(run.tasks.length, 1);
    const task = run.tasks[0];
    await db.orchestratorRun.update({ where: { id: runId }, data: { status: 'running' } });
    await db.orchestratorTask.update({ where: { id: task.id }, data: { status: 'running' } });
    const dispatchToken = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: {
        runId, taskId: task.id, machineId, provider: 'codex', status: 'running', dispatchToken,
    } });
    const finished = await fetch(`${base}/v1/orchestrator/executions/${execution.id}/finish`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'x-fixture-account': accounts[0] },
        body: JSON.stringify({ dispatchToken, status: 'completed', exitCode: 0,
            finalResponse: 'Owned public submit security fixture output' }),
    });
    const finishBody = await finished.text();
    const foreignMessageCount = await db.aiMessage.count({ where: { conversationId: foreignConversation.id } });
    console.log(`PUBLIC_HTTP_FINISH_TENANT_EVIDENCE reservedSubmit=${malicious.status} legitimateSubmit=${submitted.status} finish=${finished.status} foreignMessages=${foreignMessageCount}`);
    assert.equal(finished.status, 200, `Owned finish failed: ${finishBody}`);
    assert.equal(foreignMessageCount, 0, 'Public submit metadata caused own finish to write into another account conversation');
    console.log('REAL_DB_PUBLIC_HTTP_FINISH_FOREIGN_METADATA_REJECTED_OK');
} finally {
    await app.close();
    cleanupCounts.runs = (await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } })).count;
    cleanupCounts.conversations = (await db.aiConversation.deleteMany({ where: { accountId: accounts[1], scopeKey: tag } })).count;
    cleanupCounts.agents = (await db.aiAgent.deleteMany({ where: { accountId: accounts[1], name: tag } })).count;
    cleanupCounts.machines = (await db.machine.deleteMany({ where: { id: machineId, accountId: accounts[0] } })).count;
    cleanupCounts.accounts = (await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: publicKeyPrefix } } })).count;
    console.log(`FIXTURE_CLEANUP ${JSON.stringify(cleanupCounts)}`);
    const residual = {
        runs: await db.orchestratorRun.count({ where: { id: { in: runs }, accountId: accounts[0] } }),
        conversations: await db.aiConversation.count({ where: { accountId: accounts[1], scopeKey: tag } }),
        agents: await db.aiAgent.count({ where: { accountId: accounts[1], name: tag } }),
        machines: await db.machine.count({ where: { id: machineId, accountId: accounts[0] } }),
        accounts: await db.account.count({ where: { id: { in: accounts }, publicKey: { startsWith: publicKeyPrefix } } }),
    };
    console.log(`FIXTURE_RESIDUAL ${JSON.stringify(residual)}`);
    assert.deepEqual(residual, { runs: 0, conversations: 0, agents: 0, machines: 0, accounts: 0 }, 'Owned fixture cleanup left rows');
    await db.$disconnect();
    redis.disconnect();
}
