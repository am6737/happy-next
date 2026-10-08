import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../sources/storage/db';
import { redis } from '../sources/storage/redis';
import { assertExecutionCapabilityTx, issueExecutionCapability,
    provisionDispatchCapability, renewDispatchCapability } from '../sources/app/ai/workspaceAuth';
import { orchestratorRoutes } from '../sources/app/api/routes/orchestratorRoutes';

const tag = randomUUID();
const require = createRequire(import.meta.url);
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accountId || request.headers['x-fixture-account'] !== accountId) {
        return reply.code(401).send({ error: 'fixture' });
    }
    request.userId = accountId;
});
let accountId: string | undefined;
try {
    accountId = (await db.account.create({ data: { publicKey: `dispatch-cap-${tag}` } })).id;
    const run = await db.orchestratorRun.create({ data: { accountId, title: tag,
        status: 'running', tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex',
            prompt: 'Owned fixture', status: 'dispatching' } } }, include: { tasks: true } });
    const machineId = randomUUID();
    const dispatchToken = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId, provider: 'codex', status: 'dispatching',
        dispatchToken } });
    const capability = await provisionDispatchCapability({ accountId,
        executionId: execution.id, dispatchToken, machineId, timeoutMs: 60_000 });
    const fixed = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
    assert.equal(fixed.capabilityProtocolVersion, 1);
    assert.deepEqual(fixed.capabilityAllowedOps.sort(), capability.allowedOps.sort());
    await assert.rejects(issueExecutionCapability({ accountId, executionId: execution.id,
        allowedOps: ['finish'], expiresAt: new Date(Date.now() + 60_000) }));
    await assert.rejects(provisionDispatchCapability({ accountId, executionId: execution.id,
        dispatchToken, machineId, timeoutMs: 60_000 }));
    await db.$transaction(async tx => {
        await assertExecutionCapabilityTx(tx, { token: capability.token, accountId: accountId!,
            executionId: execution.id, machineId, operation: 'finish' });
        await assert.rejects(assertExecutionCapabilityTx(tx, { token: capability.token,
            accountId: accountId!, executionId: execution.id,
            machineId: randomUUID(), operation: 'finish' }));
        await assert.rejects(assertExecutionCapabilityTx(tx, { token: capability.token,
            accountId: accountId!, executionId: execution.id,
            machineId, operation: 'delegate' }));
    });
    await assert.rejects(renewDispatchCapability({ accountId, executionId: execution.id,
        machineId, dispatchToken: randomUUID(), token: capability.token }));
    const renewed = await renewDispatchCapability({ accountId, executionId: execution.id,
        machineId, dispatchToken, token: capability.token });
    assert.notEqual(renewed.token, capability.token);
    await db.$transaction(tx => assertExecutionCapabilityTx(tx, { token: renewed.token,
        accountId: accountId!, executionId: execution.id, machineId, operation: 'finish' }));
    const row = await db.aiExecutionCapability.findUniqueOrThrow({ where: {
        tokenHash: createHash('sha256').update(capability.token).digest('hex') } });
    await db.aiExecutionCapability.update({ where: { id: row.id },
        data: { revokedAt: new Date() } });
    await assert.rejects(db.$transaction(tx => assertExecutionCapabilityTx(tx, {
        token: capability.token, accountId: accountId!, executionId: execution.id,
        machineId, operation: 'finish',
    })));
    await db.$transaction(tx => assertExecutionCapabilityTx(tx, { token: renewed.token,
        accountId: accountId!, executionId: execution.id, machineId, operation: 'finish' }));
    await db.orchestratorTask.update({ where: { id: run.tasks[0].id },
        data: { status: 'running' } });
    await db.orchestratorExecution.update({ where: { id: execution.id },
        data: { status: 'running' } });
    orchestratorRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (operation: string, body: object) => fetch(
        `${base}/v1/orchestrator/executions/${execution.id}/${operation}`, {
            method: 'POST', signal: AbortSignal.timeout(15_000),
            headers: { 'content-type': 'application/json', 'x-fixture-account': accountId! },
            body: JSON.stringify(body),
        });
    const identity = { dispatchToken, machineId, childSessionId: randomUUID(),
        worktreePath: `/tmp/${tag}`, branchName: `happy/${tag}` };
    assert.equal((await post('identity', identity)).status, 409);
    assert.equal((await post('identity', { ...identity, capability: '0'.repeat(64) })).status, 409);
    assert.equal((await post('identity', { ...identity, capability: renewed.token })).status, 200);
    const finish = { dispatchToken, status: 'completed', exitCode: 0,
        childSessionId: identity.childSessionId, worktreePath: identity.worktreePath,
        branchName: identity.branchName, finalResponse: 'Owned capability fixture' };
    assert.equal((await post('finish', finish)).status, 409);
    assert.equal((await post('finish', { ...finish, capability: '0'.repeat(64) })).status, 409);
    assert.equal((await post('finish', { ...finish, capability: renewed.token })).status, 200);
    assert.equal((await post('finish', { ...finish, capability: renewed.token })).status, 200);
    console.log('REAL_DB_HTTP_NEW_EXECUTION_CAPABILITY_IDENTITY_FINISH_REQUIRED_OK');
    console.log('REAL_DB_DISPATCH_CAPABILITY_VERSION_OP_MACHINE_REVOKE_FENCE_OK');
} finally {
    await app.close();
    if (accountId) {
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId,
            publicKey: `dispatch-cap-${tag}` } });
        assert.equal(await db.account.count({ where: { publicKey: `dispatch-cap-${tag}` } }), 0);
    }
    await db.$disconnect();
    redis.disconnect();
}
process.exit(0);
