import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';

// Actual PostgreSQL and production HTTP handlers. Authentication and execution
// creation are owned fixtures; this does not claim daemon or Git attestation.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `identity-${randomUUID()}`; const accounts: string[] = []; const runs: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    orchestratorRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'identity', provider: 'codex', prompt: '', status: 'running',
            targetMachineId: tag, workingDirectory: `/tmp/${tag}`, branchName: `happy/${tag}` } },
    }, include: { tasks: true } }); runs.push(run.id);
    const token = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId: tag, provider: 'codex', status: 'running', dispatchToken: token } });
    const identity = { dispatchToken: token, machineId: tag, childSessionId: randomUUID(),
        worktreePath: `/tmp/${tag}/worktree`, branchName: `happy/${tag}` };
    const post = (suffix: string, body: object, account = accounts[0]) => fetch(
        `${base}/v1/orchestrator/executions/${execution.id}/${suffix}`, {
            method: 'POST', signal: AbortSignal.timeout(15000),
            headers: { 'content-type': 'application/json', 'x-fixture-account': account }, body: JSON.stringify(body),
        });
    assert.equal((await post('identity', identity, accounts[1])).status, 404);
    for (const wrong of [{ dispatchToken: randomUUID() }, { machineId: randomUUID() },
        { branchName: 'wrong-branch' }, { worktreePath: 'relative-path' }]) {
        assert.equal((await post('identity', { ...identity, ...wrong })).status, 409);
        assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).childSessionId, null);
    }
    const concurrent = await Promise.all([post('identity', identity), post('identity', identity)]);
    assert.deepEqual(concurrent.map(r => r.status), [200, 200]);
    for (const wrong of [{ childSessionId: randomUUID() }, { worktreePath: `/tmp/${tag}/other` },
        { branchName: 'wrong-branch' }]) {
        assert.equal((await post('identity', { ...identity, ...wrong })).status, 409);
    }
    const finish = { dispatchToken: token, status: 'completed', exitCode: 0,
        childSessionId: identity.childSessionId, worktreePath: identity.worktreePath,
        branchName: identity.branchName, finalResponse: 'Owned identity fixture' };
    for (const wrong of [{ childSessionId: randomUUID() }, { worktreePath: `/tmp/${tag}/other` },
        { branchName: 'wrong-branch' }]) {
        assert.equal((await post('finish', { ...finish, ...wrong })).status, 409);
        assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).status, 'running');
    }
    const newer = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId: tag, provider: 'codex', status: 'running', dispatchToken: randomUUID(), attempt: 2 } });
    assert.equal((await post('identity', identity)).status, 409, 'Old attempt rebound identity');
    await db.orchestratorExecution.delete({ where: { id: newer.id } });
    assert.equal((await post('finish', finish)).status, 200);
    assert.equal((await post('identity', identity)).status, 409, 'Terminal execution rebound identity');
    const final = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
    assert.equal(final.childSessionId, identity.childSessionId);
    assert.equal(final.worktreePath, identity.worktreePath);
    assert.equal(final.branchName, identity.branchName);
    console.log('REAL_DB_HTTP_EXECUTION_IDENTITY_IMMUTABLE_TENANT_TOKEN_MACHINE_ATTEMPT_FINISH_OK');
} finally {
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
