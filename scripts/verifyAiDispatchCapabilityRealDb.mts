import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { aiSkillRoutes } from '../packages/happy-server/sources/app/api/routes/aiSkillRoutes';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { provisionDispatchCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';

// Real provisioner, DB and HTTP consumers. Dispatch/active state and account
// authentication are owned fixtures, not feature negotiation or a daemon.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `dispatch-cap-${randomUUID()}`; const accounts: string[] = []; const runs: string[] = [];
const originalTransaction = db.$transaction.bind(db);
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    orchestratorRoutes(app); aiSkillRoutes(app); aiWorkspaceRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'cap', provider: 'codex', prompt: '', status: 'dispatching',
            targetMachineId: tag, workingDirectory: `/tmp/${tag}`, branchName: 'fixture-cap-branch',
            permissionMode: 'read_only' } } }, include: { tasks: true } }); runs.push(run.id);
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId: tag, provider: 'codex', status: 'dispatching', dispatchToken: randomUUID() } });
    const cap = await provisionDispatchCapability({ accountId: accounts[0], executionId: execution.id,
        dispatchToken: execution.dispatchToken, machineId: tag,
        timeoutMs: process.argv.includes('--renew-read-expiry') ? 60000 : 120000 });
    assert.equal(cap.protocolVersion, 1); assert.ok(cap.allowedOps.includes('identity'));
    assert.ok(cap.allowedOps.includes('finish')); assert.ok(cap.allowedOps.includes('skill_download'));
    assert.equal(cap.allowedOps.includes('delegate'), false);
    assert.equal(cap.allowedOps.includes('decision_request'), false);
    assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).capabilityProtocolVersion, 1);
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: { status: 'running' } });
    await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'running' } });
    const post = (path: string, body: object, account = accounts[0]) => fetch(`${base}${path}`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: {
            'content-type': 'application/json', 'x-fixture-account': account }, body: JSON.stringify(body),
    });
    const executionPath = `/v1/orchestrator/executions/${execution.id}`;
    const capabilityPath = `/v1/ai-team/executions/${execution.id}/capabilities`;
    assert.equal((await post(capabilityPath, { allowedOps: ['decision_request'], expiresInSeconds: 120 })).status, 409,
        'Public mint upgraded the immutable dispatch scope');
    const renewal = { dispatchToken: execution.dispatchToken, machineId: tag, capability: cap.token };
    for (const wrong of [{ dispatchToken: randomUUID() }, { machineId: randomUUID() },
        { capability: 'f'.repeat(64) }]) {
        assert.equal((await post(`${capabilityPath}/renew`, { ...renewal, ...wrong })).status, 409);
    }
    assert.equal((await post(`${capabilityPath}/renew`, renewal, accounts[1])).status, 409);
    assert.equal((await post(`${capabilityPath}/renew`, { ...renewal, allowedOps: ['delegate'] })).status, 400);
    if (process.argv.includes('--renew-read-expiry')) {
        const expiresAt = Date.parse(cap.expiresAt);
        console.log('Waiting for the originally issued capability to approach natural expiry');
        await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() - 1500)));
        let readsDelayed = 0;
        db.$transaction = ((fn: any, options: any) => originalTransaction(async (tx: any) => {
            const read = tx.orchestratorExecution.findFirst.bind(tx.orchestratorExecution);
            const wrapped = new Proxy(tx, { get(target, key) {
                if (key !== 'orchestratorExecution') return target[key];
                return new Proxy(target.orchestratorExecution, { get(model, method) {
                    if (method !== 'findFirst') return model[method];
                    return async (args: any) => {
                        const actual = await read(args);
                        if (args.where?.id === execution.id && args.select?.capabilityAllowedOps) {
                            readsDelayed++;
                            await new Promise(resolve => setTimeout(resolve,
                                Math.max(0, expiresAt + 150 - Date.now())));
                        }
                        return actual;
                    };
                } });
            } });
            return fn(wrapped);
        }, options)) as typeof db.$transaction;
        const before = await db.aiExecutionCapability.count({ where: { executionId: execution.id } });
        const expiredResponse = await post(`${capabilityPath}/renew`, renewal);
        db.$transaction = originalTransaction;
        const after = await db.aiExecutionCapability.count({ where: { executionId: execution.id } });
        console.log(JSON.stringify({ result: 'REAL_CAPABILITY_RENEW_FINAL_READ_NATURAL_EXPIRY',
            httpStatus: expiredResponse.status, readsDelayed, createdCapabilities: after - before }));
        assert.equal(readsDelayed, 1, 'Renewal did not reach the actual final execution read');
        assert.equal(expiredResponse.status, 409, 'Capability was renewed after its original natural expiry');
        assert.equal(after, before, 'Expired renewal created a new capability');
        console.log('REAL_CAPABILITY_RENEW_FINAL_READ_EXPIRY_FENCED_OK');
    } else {
    const renewedResponse = await post(`${capabilityPath}/renew`, renewal);
    assert.equal(renewedResponse.status, 201);
    const renewed = await renewedResponse.json() as typeof cap;
    assert.notEqual(renewed.token, cap.token); assert.deepEqual(renewed.allowedOps, cap.allowedOps);
    assert.equal(renewed.protocolVersion, 1);
    const identity = { dispatchToken: execution.dispatchToken, machineId: tag,
        childSessionId: randomUUID(), worktreePath: `/tmp/${tag}/worktree`, branchName: 'fixture-cap-branch' };
    assert.equal((await post(`${executionPath}/identity`, identity)).status, 409);
    assert.equal((await post(`${executionPath}/identity`, { ...identity, capability: 'f'.repeat(64) })).status, 409);
    assert.equal((await post(`${executionPath}/identity`, { ...identity, capability: cap.token }, accounts[1])).status, 404);
    assert.equal((await post(`${executionPath}/identity`, { ...identity, capability: cap.token })).status, 200);
    const skillsPath = `/v1/ai-team/tasks/${run.tasks[0].id}/skills/download`;
    const skills = { executionId: execution.id, dispatchToken: execution.dispatchToken };
    assert.equal((await post(skillsPath, skills)).status, 409);
    assert.equal((await post(skillsPath, { ...skills, capability: 'f'.repeat(64) })).status, 409);
    assert.equal((await post(skillsPath, { ...skills, capability: cap.token })).status, 200);
    const finish = { ...identity, status: 'completed', exitCode: 0, finalResponse: 'Owned capability fixture' };
    delete (finish as { machineId?: string }).machineId;
    assert.equal((await post(`${executionPath}/finish`, finish)).status, 409);
    assert.equal((await post(`${executionPath}/finish`, { ...finish, capability: 'f'.repeat(64) })).status, 409);
    assert.equal((await post(`${executionPath}/finish`, { ...finish, capability: renewed.token })).status, 200);
    assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).status, 'completed');
    assert.equal((await post(`${capabilityPath}/renew`, { ...renewal, capability: renewed.token })).status, 409);
    console.log('REAL_DB_DISPATCH_CAPABILITY_RENEWAL_FIXED_SCOPE_BINDING_NO_PUBLIC_UPGRADE_OK');
    console.log('REAL_DB_DISPATCH_CAPABILITY_IDENTITY_SKILLS_FINISH_NO_DOWNGRADE_AND_SCOPE_OK');
    }
} finally {
    db.$transaction = originalTransaction;
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_DISPATCH_CAPABILITY_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
