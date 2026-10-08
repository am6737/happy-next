import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { provisionDispatchCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';
import { createOwnedAiHumanBrowser } from './ownedAiHumanPresenceBrowser.mts';

// PostgreSQL/HTTP and real Chromium WebAuthn, with fixture account auth,
// runtime identity, independent test operator and CDP virtual authenticator.
// No physical authenticator, human identity check, App UI or daemon claim.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `human-browser-root-${randomUUID()}`;
const accounts: string[] = []; const executions: string[] = []; const runs: string[] = [];
const naturalChallenge = process.argv.includes('--challenge-natural-expiry');
assert.ok(process.argv.slice(2).every(arg => arg === '--challenge-natural-expiry'));
let human: Awaited<ReturnType<typeof createOwnedAiHumanBrowser>> | undefined;
app.decorate('authenticate', async (request: any, reply: any) => {
    const actor = request.headers['x-fixture-account'];
    if (!accounts.includes(actor)) return reply.code(401).send({ error: 'owned_fixture' });
    request.userId = actor;
});
app.get('/', async (_request: any, reply: any) => reply.type('text/html').send('<!doctype html><title>Owned WebAuthn protocol fixture</title>'));
try {
    for (const index of [0, 1]) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${index}` } })).id);
    aiWorkspaceRoutes(app); orchestratorRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: unknown, actor = accounts[0]) => fetch(`${base}/v1${path}`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
            'x-fixture-account': actor }, body: JSON.stringify(body) });
    const createExecution = async () => {
        const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag,
            status: 'running', tasks: { create: { seq: 1, taskKey: 'human', provider: 'codex', prompt: '',
                permissionMode: 'read_only', status: 'dispatching', targetMachineId: tag } } }, include: { tasks: true } });
        runs.push(run.id);
        const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
            machineId: tag, provider: 'codex', status: 'dispatching', dispatchToken: randomUUID() } });
        executions.push(execution.id);
        const capability = await provisionDispatchCapability({ accountId: accounts[0], executionId: execution.id,
            machineId: tag, dispatchToken: execution.dispatchToken, timeoutMs: 60000 });
        await db.orchestratorExecution.update({ where: { id: execution.id }, data: { status: 'running' } });
        await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'running' } });
        const identity = { machineId: tag, dispatchToken: execution.dispatchToken, childSessionId: randomUUID(),
            branchName: 'owned-human', worktreePath: `/tmp/${tag}/${execution.id}` };
        assert.equal((await post(`/orchestrator/executions/${execution.id}/identity`, {
            ...identity, capability: capability.token })).status, 200);
        return { execution, capability };
    };
    const bound = await createExecution(); const revokeBound = await createExecution();
    human = await createOwnedAiHumanBrowser({ base, accountId: accounts[0], post });
    const registration = { challengeId: human.registration.challengeId, response: human.registrationResponse };
    assert.equal((await post('/ai-team/human-credentials/registration/verify', registration)).status, 409);
    assert.equal((await post('/ai-team/human-credentials/registration/verify', registration, accounts[1])).status, 409);
    const deadline = Math.max(Date.parse(bound.capability.expiresAt), Date.parse(revokeBound.capability.expiresAt));
    console.log('REAL_BROWSER_WEBAUTHN_REGISTER_PENDING_REPLAY_AND_ACCOUNT_ISOLATION_OK waiting_original_60s_capability');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline + 150 - Date.now())));
    const requestRecovery = async (item: typeof bound) => {
        const response = await post(`/ai-team/executions/${item.execution.id}/capabilities/recovery-requests`, {
            machineId: tag, dispatchToken: item.execution.dispatchToken, expiredCapability: item.capability.token });
        assert.equal(response.status, 201); return response.json() as Promise<any>;
    };
    const recovery = await requestRecovery(bound); const revokedRecovery = await requestRecovery(revokeBound);
    const path = `/ai-team/capability-recoveries/${recovery.id}`;
    assert.equal((await post(`${path}/confirm`, { confirmation: 'drain_failed_execution', generation: 1 })).status, 400);
    assert.equal((await post(`${path}/confirmation/options`, { generation: 1 })).status, 409, 'Pending credential granted human authority');
    assert.equal((await post(`/ai-team/human-credentials/${human.credentialId}/trust`, {
        approval: human.approval, signature: 'a'.repeat(86) })).status, 409);
    assert.equal((await human.trust()).status, 200);
    assert.equal((await human.trust()).status, 409, 'Operator trust approval replay was accepted');
    assert.equal((await post(`${path}/confirmation/options`, { generation: 2 })).status, 409);
    assert.equal((await post(`${path}/confirmation/options`, { generation: 1 }, accounts[1])).status, 409);
    const wrongOrigin = await human.assertion(recovery.id, 1, true);
    assert.equal((await post(`${path}/confirm`, wrongOrigin)).status, 409);
    assert.equal((await db.aiWebAuthnChallenge.findUniqueOrThrow({ where: { id: wrongOrigin.challengeId } })).consumedAt, null);
    let assertion = await human.assertion(recovery.id, 1);
    if (naturalChallenge) {
        const challenge = await db.aiWebAuthnChallenge.findUniqueOrThrow({ where: { id: assertion.challengeId } });
        assert.ok(challenge.expiresAt.getTime() - Date.now() > 119000, 'Challenge did not have original two-minute lifetime');
        const started = Date.now();
        console.log('Waiting for original 2m WebAuthn challenge natural expiry; no deadline edits');
        while (Date.now() <= challenge.expiresAt.getTime() + 150) {
            await new Promise(resolve => setTimeout(resolve, Math.min(30000,
                Math.max(1, challenge.expiresAt.getTime() + 151 - Date.now()))));
        }
        assert.equal((await post(`${path}/confirm`, assertion)).status, 409);
        assert.equal((await db.aiWebAuthnChallenge.findUniqueOrThrow({ where: { id: assertion.challengeId } })).consumedAt, null);
        assert.equal((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } })).status, 'pending');
        console.log(`REAL_BROWSER_WEBAUTHN_CHALLENGE_NATURAL_EXPIRY_OK elapsedMs=${Date.now() - started}`);
        assertion = await human.assertion(recovery.id, 1);
    }
    assert.equal((await post(`${path}/confirm`, { ...assertion, generation: 2 })).status, 409);
    assert.equal((await post(`${path}/confirm`, assertion, accounts[1])).status, 409);
    assert.equal((await post(`${path}/confirm`, { ...assertion, challengeId: randomUUID() })).status, 409);
    const concurrent = await Promise.all([post(`${path}/confirm`, assertion), post(`${path}/confirm`, assertion)]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
    assert.equal((await post(`${path}/confirm`, assertion)).status, 409);
    assert.equal(await db.aiCapabilityRecoveryAudit.count({ where: { recoveryId: recovery.id, action: 'confirmed' } }), 1);
    const consumed = await db.aiWebAuthnChallenge.findUniqueOrThrow({ where: { id: assertion.challengeId } });
    assert.ok(consumed.consumedAt); assert.equal(consumed.recoveryId, recovery.id);
    assert.equal(consumed.generation, 1); assert.equal(consumed.action, 'drain_failed_execution');
    assert.equal(consumed.challengeHash.length, 64);
    assert.equal(consumed.challengeHash.includes(bound.capability.token), false);
    const credential = await db.aiHumanCredential.findUniqueOrThrow({ where: { id: human.credentialId } });
    assert.ok(credential.counter > 0); assert.ok(credential.lastUsedAt);
    const revokeAssertion = await human.assertion(revokedRecovery.id, 1);
    assert.equal((await post(`/ai-team/human-credentials/${human.credentialId}/revoke`, {})).status, 200);
    assert.equal((await post(`/ai-team/capability-recoveries/${revokedRecovery.id}/confirm`, revokeAssertion)).status, 409);
    assert.equal((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: revokedRecovery.id } })).status, 'pending');
    assert.equal(await db.aiCapabilityRecoveryAudit.count({ where: { recoveryId: revokedRecovery.id, action: 'confirmed' } }), 0);
    console.log('REAL_BROWSER_WEBAUTHN_INDEPENDENT_OPERATOR_TRUST_GENERATION_CHALLENGE_CAS_REPLAY_REVOKE_OK virtualAuthenticator=true humanIdentityVerified=false');
} finally {
    await human?.close(); await app.close();
    await db.aiExecutionCapability.deleteMany({ where: { executionId: { in: executions }, accountId: accounts[0] } });
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    assert.equal(await db.aiHumanCredential.count({ where: { accountId: { in: accounts } } }), 0);
    assert.equal(await db.aiWebAuthnChallenge.count({ where: { accountId: { in: accounts } } }), 0);
    console.log('AI_HUMAN_BROWSER_ROOT_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
