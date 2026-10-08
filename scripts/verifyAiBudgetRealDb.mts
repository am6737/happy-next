import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { aiBudgetRoutes } from '../packages/happy-server/sources/app/api/routes/aiBudgetRoutes';
import { settleAiBudgetTick } from '../packages/happy-server/sources/app/ai/budget';
import { submitWork } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { issueExecutionCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';

// Real PostgreSQL concurrent actual submitWork admission and usage HTTP.
// Fixture authentication/local project/RPC availability; no actual Git, provider measurement or CLI token delivery.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const accounts: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    const id = request.headers['x-fixture-account'];
    if (!accounts.includes(id)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = id;
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `budget-real-${tag}-${i}` } })).id);
    const [owner, outsider] = accounts;
    aiWorkspaceRoutes(app); aiBudgetRoutes(app); orchestratorRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = async (accountId: string, path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, { method, signal: AbortSignal.timeout(15000),
            headers: { 'x-fixture-account': accountId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() as any };
    };
    const workspace = (await call(owner, '/workspaces')).body.items.find((x: any) => x.ownerAccountId === owner);
    const policyBody = { periodStart: new Date(Date.now() - 60000).toISOString(), periodEnd: new Date(Date.now() + 3600000).toISOString(),
        limitMicros: '100', perRunReserveMicros: '60' };
    assert.equal((await call(outsider, `/workspaces/${workspace.id}/budget`, 'PUT', policyBody)).status, 404);
    const policyResponse = await call(owner, `/workspaces/${workspace.id}/budget`, 'PUT', policyBody);
    assert.equal(policyResponse.status, 201);
    assert.equal((await call(owner, `/workspaces/${workspace.id}/budget`, 'PUT', policyBody)).status, 409);
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId: owner, metadata: '{}', active: true } });
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-dispatch`, { connected: true } as any);
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', model: 'default', instructions: '', workingDirectory: '/owned-budget-fixture', permissionMode: 'read_only', allowDelegation: false } } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner, agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const project = await db.aiProject.create({ data: { accountId: owner, name: tag, clientRequestId: tag } });
    const projectFixture = { projectId: project.id, version: 1, kind: 'local', repositoryId: null,
        repositoryFullName: null, machineId, workingDirectory: '/owned-budget-fixture', defaultBranch: 'main', baseCommit: 'a'.repeat(40), runOnly: true };
    const candidates = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => submitWork(owner, {
        agentId: agent.id, conversationId: conversation.id, title: `${tag}-${i}`, summary: 'Owned budget fixture',
        sourceType: 'execution', sourceLabel: 'Independent budget acceptance' }, undefined, undefined, projectFixture)));
    const admitted = candidates.filter((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled');
    assert.equal(admitted.length, 1);
    assert.equal(await db.orchestratorRun.count({ where: { accountId: owner } }), 1);
    const policy = await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policyResponse.body.id } });
    assert.equal(policy.reservedMicros, 60n); assert.equal(policy.usedMicros, 0n);
    console.log('REAL_DB_BUDGET_FOUR_CONCURRENT_ADMISSIONS_ONE_RESERVATION_OK');
    assert.equal(await db.aiWorkItem.count({ where: { accountId: owner } }), 1);
    assert.equal(await db.aiMessage.count({ where: { conversationId: conversation.id } }), 1);
    const run = await db.orchestratorRun.findUniqueOrThrow({ where: { id: admitted[0].value.runId }, include: { tasks: true } });
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    const cap = await issueExecutionCapability({ accountId: owner, executionId: execution.id,
        allowedOps: ['usage'], expiresAt: new Date(Date.now() + 60000) });
    const path = `/executions/${execution.id}/usage-deltas`;
    const usage = { sourceEventId: tag, machineId, capability: cap.token, provider: 'codex', model: 'default',
        inputTokens: 10, outputTokens: 5, costMicros: '30', pricingVersion: 'fixture-only', measuredAt: new Date().toISOString() };
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => call(owner, path, 'POST', usage)));
    assert.ok(concurrent.every(x => [200, 201, 409].includes(x.status)));
    assert.ok(concurrent.some(x => x.status === 201));
    assert.equal((await call(owner, path, 'POST', usage)).status, 200);
    assert.equal(await db.aiUsageDelta.count({ where: { executionId: execution.id } }), 1);
    assert.equal((await call(owner, path, 'POST', { ...usage, outputTokens: 6 })).status, 409);
    assert.equal((await call(outsider, path, 'POST', usage)).status, 409);
    assert.equal((await call(owner, path, 'POST', { ...usage, sourceEventId: tag+'wrong', machineId: randomUUID() })).status, 409);
    assert.equal((await call(owner, path, 'POST', { ...usage, sourceEventId: tag+'model', model: 'wrong-model' })).status, 409);
    await db.orchestratorRun.update({ where: { id: run.id }, data: { status: 'completed' } });
    await Promise.all(Array.from({ length: 4 }, () => settleAiBudgetTick(owner)));
    const settled = await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    assert.equal(settled.usedMicros, 30n); assert.equal(settled.reservedMicros, 0n);
    const reservation = await db.aiBudgetReservation.findUniqueOrThrow({ where: { runId: run.id } });
    assert.equal(reservation.status, 'settled'); assert.equal(reservation.actualMicros, 30n);
    assert.equal((await call(outsider, `/workspaces/${workspace.id}/budgets`)).status, 404);
    console.log('REAL_DB_HTTP_USAGE_REPLAY_SCOPE_AND_CONCURRENT_BUDGET_SETTLEMENT_OK');
    const unknownWork = await submitWork(owner, { agentId: agent.id, conversationId: conversation.id,
        title: tag+'-unknown', summary: 'Owned unknown-price fixture', sourceType: 'execution', sourceLabel: 'Independent budget acceptance' },
        undefined, undefined, projectFixture);
    const unknownExecution = await db.orchestratorExecution.create({ data: { runId: unknownWork.runId,
        taskId: unknownWork.executionId, machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    const unknownCap = await issueExecutionCapability({ accountId: owner, executionId: unknownExecution.id,
        allowedOps: ['usage'], expiresAt: new Date(Date.now() + 60000) });
    const unknownUsage = { ...usage, sourceEventId: tag+'unknown', capability: unknownCap.token,
        costMicros: null, pricingVersion: null };
    assert.equal((await call(owner, `/executions/${unknownExecution.id}/usage-deltas`, 'POST', unknownUsage)).status, 201);
    const storedUnknown = await db.aiUsageDelta.findUniqueOrThrow({ where: { executionId_sourceEventId: {
        executionId: unknownExecution.id, sourceEventId: unknownUsage.sourceEventId } } });
    assert.equal(storedUnknown.costMicros, null);
    await db.orchestratorRun.update({ where: { id: unknownWork.runId }, data: { status: 'completed' } });
    await settleAiBudgetTick(owner); await settleAiBudgetTick(owner);
    const unknownReservation = await db.aiBudgetReservation.findUniqueOrThrow({ where: { runId: unknownWork.runId } });
    assert.equal(unknownReservation.status, 'unknown'); assert.equal(unknownReservation.actualMicros, null);
    const conservative = await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    assert.equal(conservative.usedMicros, 30n); assert.equal(conservative.reservedMicros, 60n);
    console.log('REAL_DB_HTTP_UNKNOWN_PRICE_NOT_ZERO_CONSERVATIVE_RESERVATION_OK');
    const ordinary = await fetch(`${base}/v1/orchestrator/submit`, { method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'x-fixture-account': owner, 'content-type': 'application/json' },
        body: JSON.stringify({ title: tag+'ordinary', mode: 'async', idempotencyKey: tag+'ordinary',
            tasks: [{ taskKey: 'primary', provider: 'codex', prompt: 'Owned budget admission fixture', target: { type: 'machine_id', machineId } }] }) });
    assert.equal(ordinary.status, 429, 'Ordinary orchestrator submit bypassed Workspace budget');
    assert.equal(await db.orchestratorRun.count({ where: { accountId: owner } }), 2);
    assert.equal(await db.aiBudgetReservation.count({ where: { policyId: policy.id } }), 2);
    console.log('REAL_DB_HTTP_ORDINARY_ORCHESTRATOR_BUDGET_REJECTS_AND_ROLLS_BACK_OK');
    const resolvePath = `/budget-reservations/${unknownReservation.id}/resolve`;
    const resolution = { clientRequestId: tag+'resolve', actualMicros: '10', note: 'Owned explicit fixture cost reconciliation; not provider pricing' };
    assert.equal((await call(outsider, resolvePath, 'POST', resolution)).status, 404);
    const resolutions = await Promise.all(Array.from({ length: 4 }, () => call(owner, resolvePath, 'POST', resolution)));
    assert.ok(resolutions.every(x => x.status === 200));
    assert.equal((await call(owner, resolvePath, 'POST', { ...resolution, actualMicros: '20' })).status, 409);
    const reconciled = await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    assert.equal(reconciled.reservedMicros, 0n); assert.equal(reconciled.usedMicros, 40n);
    const manual = await db.aiBudgetReservation.findUniqueOrThrow({ where: { id: unknownReservation.id } });
    assert.equal(manual.resolvedBy, owner); assert.equal(manual.resolutionRequestId, resolution.clientRequestId);
    await settleAiBudgetTick(owner);
    assert.equal((await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } })).usedMicros, 40n);
    console.log('REAL_DB_HTTP_UNKNOWN_BUDGET_MANUAL_RESOLUTION_CONCURRENCY_AUDIT_AND_CONTENT_CONFLICT_OK');

    // A late, distinct usage delta for the automatically settled first run
    // must still count once. Use its already-issued capability, not reminting
    // a capability for a terminal execution.
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: { status: 'completed' } });
    const late = { ...usage, sourceEventId: tag+'late', inputTokens: 2, outputTokens: 1, costMicros: '10', measuredAt: new Date().toISOString() };
    assert.equal((await call(owner, path, 'POST', late)).status, 201);
    assert.equal((await call(owner, path, 'POST', late)).status, 200);
    await settleAiBudgetTick(owner); await settleAiBudgetTick(owner);
    const withLate = await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_LATE_USAGE_AFTER_AUTOMATIC_SETTLEMENT', usedMicros: withLate.usedMicros.toString(), expectedMicros: '50' }));
    assert.equal(withLate.usedMicros, 50n, 'Accepted late usage was silently omitted from settled budget');
    console.log('REAL_DB_HTTP_LATE_USAGE_AFTER_SETTLEMENT_COUNTED_EXACTLY_ONCE_OK');
    // Distinct late deltas can arrive out of measurement order while multiple
    // settlement workers run. Each accepted amount must enter the ledger once.
    const lateBatch = [1, 2, 3].map((cost, i) => ({ ...late,
        sourceEventId: `${tag}late-batch-${i}`, costMicros: String(cost),
        measuredAt: new Date(Date.now() - (i + 1) * 1000).toISOString() }));
    const batch = await Promise.all(lateBatch.map(item => call(owner, path, 'POST', item)));
    // Existing usage contract exposes Serializable conflicts as 409; retry
    // the same immutable event, as the durable CLI queue does on the next flush.
    assert.ok(batch.every(item => [201, 409].includes(item.status)));
    for (let i = 0; i < batch.length; i++) {
        if (batch[i].status === 409) assert.equal((await call(owner, path, 'POST', lateBatch[i])).status, 201);
    }
    await Promise.all(Array.from({ length: 4 }, () => settleAiBudgetTick(owner)));
    assert.equal((await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } })).usedMicros, 56n);
    assert.ok((await Promise.all(lateBatch.map(item => call(owner, path, 'POST', item))))
        .every(item => item.status === 200));
    await Promise.all(Array.from({ length: 4 }, () => settleAiBudgetTick(owner)));
    const finalPolicy = await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } });
    assert.equal(finalPolicy.usedMicros, 56n); assert.equal(finalPolicy.reservedMicros, 0n);
    assert.equal((await db.aiBudgetReservation.findUniqueOrThrow({ where: { id: reservation.id } })).actualMicros, 46n);
    assert.equal((await db.aiBudgetReservation.findUniqueOrThrow({ where: { id: manual.id } })).actualMicros, 10n);
    console.log('REAL_DB_HTTP_OUT_OF_ORDER_LATE_USAGE_CONCURRENT_WORKERS_NO_DOUBLE_COUNT_OK');
    const beforeReconciliation = await db.aiUsageDelta.count({ where: { accountId: owner } });
    // Unknown late prices cannot become zero, and an explicit human final total
    // cannot be silently changed by subsequent deltas. Reject atomically until
    // a separate reconciliation is authorized; already accepted events replay.
    assert.equal((await call(owner, path, 'POST', { ...late,
        sourceEventId: tag+'late-unknown', costMicros: null, pricingVersion: null })).status, 409);
    const manualUsagePath = `/executions/${unknownExecution.id}/usage-deltas`;
    assert.equal((await call(owner, manualUsagePath, 'POST', { ...unknownUsage,
        sourceEventId: tag+'manual-late', costMicros: '5', pricingVersion: 'fixture-only' })).status, 409);
    assert.equal((await call(owner, manualUsagePath, 'POST', unknownUsage)).status, 200);
    assert.equal(await db.aiUsageDelta.count({ where: { accountId: owner } }), beforeReconciliation);
    assert.equal((await db.aiBudgetPolicy.findUniqueOrThrow({ where: { id: policy.id } })).usedMicros, 56n);
    assert.equal((await db.aiBudgetReservation.findUniqueOrThrow({ where: { id: manual.id } })).actualMicros, 10n);
    console.log('REAL_DB_HTTP_LATE_UNKNOWN_AND_MANUAL_FINAL_TOTAL_REQUIRE_RECONCILIATION_ROLLBACK_OK');
} finally {
    await app.close();
    await db.aiUsageDelta.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiWorkspace.deleteMany({ where: { ownerAccountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    for (const accountId of accounts) getOrCreateUserRpcListeners(accountId).clear();
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiProject.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.machine.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `budget-real-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
