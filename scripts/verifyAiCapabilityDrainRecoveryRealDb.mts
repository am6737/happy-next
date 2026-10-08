import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createOwnedAiHumanBrowser } from './ownedAiHumanPresenceBrowser.mts';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { provisionDispatchCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';
import { getOrCreateUserRpcListeners, cleanupUserRpcSocket } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { AiExecutionCapabilitySchema, AiHumanRecoveryConfirmInputSchema } from 'happy-wire';

// Real provisioner/HTTP/DB and original 60s natural capability expiry. Auth,
// runtime rows and the feature RPC acknowledgement are owned fixtures. This
// verifies drain scope and response-loss replay with real Chromium WebAuthn
// and a CDP virtual authenticator/independent test operator, not a daemon,
// physical authenticator, App UI or human identity verification.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `drain-recovery-${randomUUID()}`; const accounts: string[] = []; const runs: string[] = [];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && ['--claim-short-deadline-race',
    '--second-drain-expiry', '--second-drain-natural-expiry', '--request-natural-expiry',
    '--credential-revoke-during-claim'].includes(args[0]));
const deadlineRace = args.includes('--claim-short-deadline-race');
const revokeDuringClaim = args.includes('--credential-revoke-during-claim');
const secondDrain = args.some(arg => arg.startsWith('--second-drain-'));
const secondDrainNatural = args.includes('--second-drain-natural-expiry');
const requestNatural = args.includes('--request-natural-expiry');
const originalTransaction = db.$transaction.bind(db);
let rpc: any;
let human: Awaited<ReturnType<typeof createOwnedAiHumanBrowser>> | undefined;
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    orchestratorRoutes(app); aiWorkspaceRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: unknown, account = accounts[0]) => fetch(`${base}/v1${path}`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
            'x-fixture-account': account }, body: JSON.stringify(body),
    });
    human = await createOwnedAiHumanBrowser({ base, accountId: accounts[0], post });
    assert.equal((await human.trust()).status, 200);
    const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag,
        status: 'running', tasks: { create: { seq: 1, taskKey: 'drain', provider: 'codex', prompt: '',
            permissionMode: 'read_only', status: 'dispatching', targetMachineId: tag,
            workingDirectory: `/tmp/${tag}`, branchName: 'fixture-drain' } } }, include: { tasks: true } });
    runs.push(run.id);
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId: tag, provider: 'codex', status: 'dispatching', dispatchToken: randomUUID() } });
    const capability = await provisionDispatchCapability({ accountId: accounts[0], executionId: execution.id,
        dispatchToken: execution.dispatchToken, machineId: tag, timeoutMs: 60000 });
    AiExecutionCapabilitySchema.parse(capability);
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: { status: 'running' } });
    await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'running' } });
    const identity = { dispatchToken: execution.dispatchToken, machineId: tag, childSessionId: randomUUID(),
        worktreePath: `/tmp/${tag}/worktree`, branchName: 'fixture-drain' };
    const path = `/ai-team/executions/${execution.id}/capabilities`;
    assert.equal((await post(`/orchestrator/executions/${execution.id}/identity`, {
        ...identity, capability: capability.token })).status, 200);
    const proof = { machineId: tag, dispatchToken: execution.dispatchToken, expiredCapability: capability.token };
    assert.equal((await post(`${path}/recovery-requests`, proof)).status, 409, 'Unexpired capability was eligible for recovery');
    console.log('Waiting for original 60s capability natural expiry; no database expiry edits');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(capability.expiresAt) + 150 - Date.now())));
    assert.equal((await post(`${path}/renew`, { ...proof, expiredCapability: undefined, capability: capability.token })).status, 409);
    assert.equal((await post(`${path}/recovery-requests`, proof, accounts[1])).status, 409);
    assert.equal((await post(`${path}/recovery-requests`, { ...proof, dispatchToken: randomUUID() })).status, 409);
    const requested = await post(`${path}/recovery-requests`, proof); assert.equal(requested.status, 201);
    let recovery = await requested.json() as any;
    const duplicate = await post(`${path}/recovery-requests`, proof); assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as any).id, recovery.id);
    const recoveryPath = `/ai-team/capability-recoveries/${recovery.id}`;
    const claim = { executionId: execution.id, ...proof };
    assert.equal((await post(`${recoveryPath}/claim`, claim)).status, 409);
    const firstAssertion = await human.assertion(recovery.id, recovery.generation);
    assert.equal((await post(`${recoveryPath}/confirm`, firstAssertion, accounts[1])).status, 409);
    assert.equal((await post(`${recoveryPath}/confirm`, { confirmation: 'restart_execution' })).status, 400);
    if (requestNatural) {
        const original = await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } });
        const deadline = original.requestExpiresAt.getTime();
        assert.equal(recovery.generation, 1);
        assert.equal(original.status, 'pending');
        assert.ok(deadline - Date.now() > 899000, 'Server did not issue the original fifteen-minute request duration');
        const started = Date.now();
        let lastReport = 0;
        while (Date.now() <= deadline + 150) {
            if (Date.now() - lastReport >= 60000) {
                console.log(JSON.stringify({ phase: 'waiting_for_request_expiry', natural: true,
                    elapsedMs: Date.now() - started })); lastReport = Date.now();
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1, deadline + 151 - Date.now()))));
        }
        const before = await db.aiExecutionCapability.count({ where: { executionId: execution.id } });
        assert.equal((await post(`${recoveryPath}/confirm`, firstAssertion)).status, 409);
        assert.equal((await post(`${recoveryPath}/claim`, { ...claim, generation: 1 })).status, 409);
        assert.equal(await db.aiExecutionCapability.count({ where: { executionId: execution.id } }), before);
        const reopened = await post(`${path}/recovery-requests`, proof);
        assert.equal(reopened.status, 201); recovery = await reopened.json() as any;
        assert.equal(recovery.id, original.id); assert.equal(recovery.generation, 2);
        assert.equal(recovery.status, 'pending');
        assert.equal((await post(`${recoveryPath}/confirm`, { confirmation: 'drain_failed_execution' })).status, 400);
        assert.equal((await post(`${recoveryPath}/confirm`, firstAssertion)).status, 409);
        assert.equal((await post(`${recoveryPath}/claim`, { ...claim, generation: 2 })).status, 409);
        console.log(JSON.stringify({ result: 'REAL_UNCONFIRMED_REQUEST_NATURAL_EXPIRY_NEW_GENERATION',
            elapsedMs: Date.now() - started, requestDeadlineFixtureShortened: false, generation: recovery.generation }));
    }
    const currentAssertion = requestNatural ? await human.assertion(recovery.id, recovery.generation) : firstAssertion;
    AiHumanRecoveryConfirmInputSchema.parse(currentAssertion);
    // The original token still expired naturally. Only this owned recovery
    // fixture's request deadline is shortened before owner confirmation to
    // isolate a final-read race without pretending to test the 15m duration.
    let recoveryDeadline = 0;
    if (deadlineRace) {
        recoveryDeadline = Date.now() + 2500;
        await db.aiCapabilityRecoveryRequest.update({ where: { id: recovery.id },
            data: { requestExpiresAt: new Date(recoveryDeadline) } });
    }
    assert.equal((await post(`${recoveryPath}/confirm`, currentAssertion)).status, 200);
    let revokeOnFeature = false;
    let revokedDuringFeature = false;
    rpc = { connected: true, timeout: () => rpc, emitWithAck: async (_event: string, message: any) => {
        if (revokeOnFeature) {
            revokeOnFeature = false;
            assert.equal((await post(`/ai-team/human-credentials/${human!.credentialId}/revoke`, {})).status, 200);
            revokedDuringFeature = true;
        }
        return { nonce: message.params.nonce, machineId: tag,
            protocolVersion: 1, executionCapabilityVersion: 1 };
    } };
    getOrCreateUserRpcListeners(accounts[0]).set(`${tag}:orchestrator-features`, rpc);
    assert.equal((await post(`${recoveryPath}/claim`, { ...claim, machineId: randomUUID() })).status, 409);
    if (revokeDuringClaim) {
        // Real credential DELETE/POST commits after the claim route has read
        // the confirmed candidate and before the feature ACK releases it.
        const before = await db.aiExecutionCapability.count({ where: { executionId: execution.id } });
        revokeOnFeature = true;
        const claimed = await post(`${recoveryPath}/claim`, { ...claim, generation: recovery.generation });
        assert.equal(revokedDuringFeature, true, 'Claim did not reach the controlled feature ACK barrier');
        assert.equal(claimed.status, 409);
        assert.equal(await db.aiExecutionCapability.count({ where: { executionId: execution.id } }), before);
        assert.equal((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } })).status, 'revoked');
        assert.equal(await db.aiCapabilityRecoveryAudit.count({ where: { recoveryId: recovery.id, action: 'confirmed' } }), 1);
        console.log('REAL_HTTP_BROWSER_CONFIRMED_CREDENTIAL_REVOKE_BEFORE_CLAIM_ACK_NO_DRAIN_OK fixtureRpc=true');
    } else if (deadlineRace) {
        let delayedReads = 0;
        (db as any).$transaction = (fn: any, options: any) => originalTransaction(async (tx: any) => fn(new Proxy(tx, {
            get(target, key) {
                if (key !== 'aiCapabilityRecoveryRequest') {
                    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
                }
                return new Proxy(target.aiCapabilityRecoveryRequest, { get(model, method) {
                    const value = model[method];
                    if (method !== 'findUnique') return typeof value === 'function' ? value.bind(model) : value;
                    return async (query: any) => {
                        const actual = await value.call(model, query);
                        if (query.where?.id === recovery.id) {
                            delayedReads++;
                            await new Promise(resolve => setTimeout(resolve, Math.max(0, recoveryDeadline + 150 - Date.now())));
                        }
                        return actual;
                    };
                } });
            },
        })), options);
        const before = await db.aiExecutionCapability.count({ where: { executionId: execution.id } });
        const expiredClaim = await post(`${recoveryPath}/claim`, claim);
        (db as any).$transaction = originalTransaction;
        const after = await db.aiExecutionCapability.count({ where: { executionId: execution.id } });
        console.log(JSON.stringify({ result: 'REAL_DRAIN_CLAIM_LAST_READ_CROSSES_REQUEST_DEADLINE',
            recoveryDeadlineFixtureShortened: true, originalTokenNaturalExpiry: true,
            httpStatus: expiredClaim.status, delayedReads, createdCapabilities: after - before }));
        assert.equal(delayedReads, 1);
        assert.equal(expiredClaim.status, 409, 'Expired recovery request still minted a drain capability');
        assert.equal(after, before);
        console.log('REAL_DB_HTTP_DRAIN_CLAIM_FINAL_READ_REQUEST_EXPIRY_FENCE_OK');
    } else {
    const claimed = await post(`${recoveryPath}/claim`, { ...claim,
        ...(requestNatural ? { generation: recovery.generation } : {}) }); assert.equal(claimed.status, 201);
    let drain = await claimed.json() as any;
    AiExecutionCapabilitySchema.parse(drain);
    assert.equal(drain.recoveryMode, 'drain'); assert.equal(drain.protocolVersion, 1);
    assert.deepEqual([...drain.allowedOps].sort(), ['event', 'finish', 'usage']);
    assert.notEqual(drain.token, capability.token);
    if (secondDrain) {
        const oldDrain = drain;
        assert.equal(recovery.generation, 1);
        const naturalDeadline = Date.parse(oldDrain.expiresAt);
        assert.ok(naturalDeadline - Date.now() > 599000, 'Server did not issue the original ten-minute drain duration');
        if (!secondDrainNatural) {
            await db.aiExecutionCapability.update({ where: {
                tokenHash: createHash('sha256').update(oldDrain.token).digest('hex') },
            data: { expiresAt: new Date(Date.now() + 250) } });
        }
        const waitStarted = Date.now();
        const deadline = secondDrainNatural ? naturalDeadline : Date.now() + 400;
        let lastReport = 0;
        while (Date.now() <= deadline + 150) {
            if (Date.now() - lastReport > 60000) {
                console.log(JSON.stringify({ phase: 'waiting_for_drain_expiry', natural: secondDrainNatural,
                    elapsedMs: Date.now() - waitStarted })); lastReport = Date.now();
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1, deadline + 151 - Date.now()))));
        }
        assert.equal((await post(`${recoveryPath}/claim`, claim)).status, 409);
        assert.equal((await post(`${path}/renew`, { machineId: tag, dispatchToken: execution.dispatchToken,
            capability: oldDrain.token })).status, 409);
        const reopened = await post(`${path}/recovery-requests`, proof);
        assert.equal(reopened.status, 201); const second = await reopened.json() as any;
        assert.equal(second.id, recovery.id); assert.equal(second.generation, 2);
        assert.equal(second.status, 'pending');
        assert.equal((await post(`${recoveryPath}/confirm`, { confirmation: 'drain_failed_execution' })).status, 400);
        assert.equal((await post(`${recoveryPath}/confirm`, firstAssertion)).status, 409);
        assert.equal((await post(`${recoveryPath}/claim`, { ...claim, generation: 2 })).status, 409);
        const secondAssertion = await human.assertion(second.id, second.generation);
        assert.equal((await post(`${recoveryPath}/confirm`, secondAssertion, accounts[1])).status, 409);
        assert.equal((await post(`${recoveryPath}/confirm`, secondAssertion)).status, 200);
        assert.equal((await post(`${recoveryPath}/claim`, { ...claim, generation: 1 })).status, 409);
        const secondClaim = await post(`${recoveryPath}/claim`, { ...claim, generation: 2 });
        assert.equal(secondClaim.status, 201); drain = await secondClaim.json() as any;
        AiExecutionCapabilitySchema.parse(drain);
        assert.notEqual(drain.token, oldDrain.token);
        assert.equal(drain.recoveryMode, 'drain');
        assert.deepEqual([...drain.allowedOps].sort(), ['event', 'finish', 'usage']);
        assert.equal((await post(`/orchestrator/executions/${execution.id}/finish`, {
            ...identity, capability: oldDrain.token, status: 'failed', exitCode: 1,
            errorCode: 'EXECUTION_CAPABILITY_EXPIRED' })).status, 409);
        const auditResponse = await fetch(`${base}/v1${recoveryPath}/audit`, { headers: { 'x-fixture-account': accounts[0] } });
        assert.equal(auditResponse.status, 200); const audit = await auditResponse.json() as any;
        assert.equal(audit.generation, 2);
        for (const generation of [1, 2]) assert.deepEqual(audit.audit.filter((row: any) => row.generation === generation)
            .map((row: any) => row.action).sort(), ['requested', 'confirmed', 'claimed', 'human_verified'].sort());
        assert.ok(![oldDrain.token, drain.token, capability.token, identity.worktreePath].some(value => JSON.stringify(audit).includes(value)));
        assert.equal((await fetch(`${base}/v1${recoveryPath}/audit`, { headers: { 'x-fixture-account': accounts[1] } })).status, 404);
        console.log(JSON.stringify({ result: 'REAL_SECOND_DRAIN_EXPIRY_OWNER_RECONFIRM_GENERATION_AND_AUDIT',
            naturalTenMinuteExpiry: secondDrainNatural, drainDeadlineFixtureShortened: !secondDrainNatural,
            elapsedMs: Date.now() - waitStarted, generation: second.generation, oldDrainFinishStatus: 409 }));
    }
    assert.equal((await post(`/orchestrator/executions/${execution.id}/identity`, {
        ...identity, capability: drain.token })).status, 409);
    const finish = { dispatchToken: execution.dispatchToken, capability: drain.token,
        childSessionId: identity.childSessionId, worktreePath: identity.worktreePath,
        branchName: identity.branchName, status: 'failed', exitCode: 1, errorCode: 'EXECUTION_CAPABILITY_EXPIRED' };
    assert.equal((await post(`/orchestrator/executions/${execution.id}/finish`, {
        ...finish, status: 'completed', exitCode: 0, finalResponse: 'Must not claim success' })).status, 409);
    assert.equal((await post(`/orchestrator/executions/${execution.id}/finish`, {
        ...finish, errorCode: 'OTHER_ERROR' })).status, 409);
    const first = await post(`/orchestrator/executions/${execution.id}/finish`, finish);
    assert.equal(first.status, 200);
    const replay = await post(`/orchestrator/executions/${execution.id}/finish`, finish);
    console.log(JSON.stringify({ result: 'REAL_CAPABILITY_EXPIRED_EXPLICIT_DRAIN_FINISH_REPLAY',
        firstStatus: first.status, replayStatus: replay.status,
        allowedOps: drain.allowedOps, recoveryMode: drain.recoveryMode }));
    assert.equal(replay.status, 200, 'Lost drain finish ACK cannot be recovered by identical durable replay');
    assert.equal(await db.orchestratorExecution.count({ where: { runId: run.id } }), 1);
    assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'failed');
    console.log('REAL_DB_HTTP_NATURAL_EXPIRED_OWNER_CONFIRM_MINIMAL_DRAIN_AND_FINISH_REPLAY_OK');
    }
} finally {
    (db as any).$transaction = originalTransaction;
    if (rpc && accounts[0]) await cleanupUserRpcSocket(accounts[0], rpc);
    await human?.close();
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_CAPABILITY_DRAIN_RECOVERY_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
