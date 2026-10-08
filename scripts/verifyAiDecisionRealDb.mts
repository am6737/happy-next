import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { aiDecisionRoutes } from '../packages/happy-server/sources/app/api/routes/aiDecisionRoutes';
import { decisionOutboxTick } from '../packages/happy-server/sources/app/ai/decisionOutbox';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { issueExecutionCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';

// Real PostgreSQL and actual Decision HTTP/outbox with two reviewers.
// Fixture authentication/execution/RPC transport; no daemon or UI recovery claim.
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
    for (let i = 0; i < 3; i++) accounts.push((await db.account.create({ data: { publicKey: `decision-real-${tag}-${i}` } })).id);
    const [owner, admin, outsider] = accounts;
    aiWorkspaceRoutes(app); aiDecisionRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = async (accountId: string, path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, { method, signal: AbortSignal.timeout(15000),
            headers: { 'x-fixture-account': accountId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() as any };
    };
    const workspace = (await call(owner, '/workspaces')).body.items.find((x: any) => x.ownerAccountId === owner);
    assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${admin}`, 'PUT', { role: 'admin' })).status, 200);
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner, agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex', prompt: 'Owned fixture', status: 'running' } } }, include: { tasks: true } });
    const machineId = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    const work = await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned fixture', sourceType: 'execution',
        sourceLabel: 'Owned fixture', sourceResourceId: tag, assigneeId: agent.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
    const cap = await issueExecutionCapability({ accountId: owner, executionId: execution.id,
        allowedOps: ['decision_request'], expiresAt: new Date(Date.now() + 60000) });
    const requestPath = `/executions/${execution.id}/decisions`;
    const input = { machineId, capability: cap.token, kind: 'approval', summary: 'Owned bounded operation', expiresAt: new Date(Date.now()+60000).toISOString() };
    assert.equal((await call(outsider, requestPath, 'POST', input)).status, 409);
    assert.equal((await call(owner, requestPath, 'POST', { ...input, machineId: randomUUID() })).status, 409);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => call(owner, requestPath, 'POST', input)));
    assert.ok(concurrent.every(x => [201,409].includes(x.status)));
    const created = concurrent.find(x => x.status === 201)!; assert.ok(created);
    assert.equal(await db.aiDecisionRequest.count({ where: { executionId: execution.id } }), 1);
    assert.equal((await call(outsider, '/decisions')).body.items.length, 0);
    assert.equal((await call(admin, '/decisions?status=pending')).body.items[0].workItemId, work.id);
    const responsePath = `/decisions/${created.body.id}/respond`;
    const reply = { version: 1, clientRequestId: tag, decision: 'approved', note: 'Owned approval' };
    assert.equal((await call(outsider, responsePath, 'POST', reply)).status, 404);
    const race = await Promise.all([call(owner, responsePath, 'POST', reply), call(admin, responsePath, 'POST', { ...reply, clientRequestId: tag+'admin' })]);
    assert.deepEqual(race.map(x=>x.status).sort(), [200,409]);
    const decided = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(decided.status, 'decided'); assert.equal(decided.version, 2); assert.equal(decided.deliveryStatus, 'pending');
    const winnerReply = decided.decidedBy === owner ? reply : { ...reply, clientRequestId: tag+'admin' };
    assert.equal((await call(decided.decidedBy!, responsePath, 'POST', winnerReply)).status, 200);
    await decisionOutboxTick(new Date(), owner);
    assert.equal((await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: decided.id } })).deliveryStatus, 'pending');
    let deliveries = 0; let accept = false;
    const rpc = { connected: true, timeout: () => ({ emitWithAck: async (_event: string, payload: any) => {
        const args = payload.params; assert.equal(args.executionId, execution.id);
        assert.equal(args.dispatchToken, execution.dispatchToken); assert.equal(args.decisionId, decided.id);
        deliveries++; return { accepted: accept };
    } }) } as any;
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-decision`, rpc);
    await decisionOutboxTick(new Date(), owner);
    assert.equal((await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: decided.id } })).deliveryStatus, 'pending');
    accept = true;
    await db.aiDecisionRequest.update({ where: { id: decided.id }, data: { nextAttemptAt: new Date(Date.now()-1000) } });
    await Promise.all(Array.from({ length: 4 }, () => decisionOutboxTick(new Date(), owner)));
    assert.equal((await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: decided.id } })).deliveryStatus, 'delivered');
    assert.equal(deliveries, 2); assert.equal(await db.orchestratorRun.count({ where: { accountId: owner } }), 1);
    console.log('REAL_DB_HTTP_DECISION_TWO_REVIEWERS_CAS_REPLAY_AND_DURABLE_ORIGINAL_EXECUTION_OUTBOX_OK');
    // Multiple bounded operations in one execution must not share one approval.
    // Session/worktree identities are owned DB fixtures, not actual CLI state.
    const sessionId = randomUUID(); const worktreePath = `/owned-decision-fixture/${tag}`;
    const branchName = `happy-agent/${tag}`;
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: {
        childSessionId: sessionId, worktreePath, branchName } });
    const operation = { ...input, operationId: tag+'op1', actionType: 'shell',
        actionHash: createHash('sha256').update('owned-fixture-command-one').digest('hex') };
    assert.equal((await call(owner, requestPath, 'POST', { ...input, operationId: tag+'incomplete' })).status, 400);
    const op1 = await call(owner, requestPath, 'POST', operation);
    assert.equal(op1.status, 201);
    const sameOp = await call(owner, requestPath, 'POST', operation);
    assert.equal(sameOp.status, 201); assert.equal(sameOp.body.id, op1.body.id);
    assert.equal((await call(owner, requestPath, 'POST', { ...operation,
        actionHash: createHash('sha256').update('owned-fixture-command-changed').digest('hex') })).status, 409);
    const op2 = await call(owner, requestPath, 'POST', { ...operation, operationId: tag+'op2',
        actionHash: createHash('sha256').update('owned-fixture-command-two').digest('hex') });
    assert.equal(op2.status, 201); assert.notEqual(op2.body.id, op1.body.id);
    assert.equal(await db.aiDecisionRequest.count({ where: { executionId: execution.id } }), 3);
    assert.equal((await call(owner, `/decisions/${op1.body.id}/respond`, 'POST', {
        ...reply, clientRequestId: tag+'approve-op1' })).status, 200);
    let operationDeliveries = 0;
    const operationRpc: any = { connected: true, timeout: () => operationRpc,
        emitWithAck: async (_event: string, payload: any) => {
            assert.equal(payload.params.decisionId, op1.body.id);
            assert.equal(payload.params.operationId, operation.operationId);
            assert.equal(payload.params.actionHash, operation.actionHash);
            assert.equal(payload.params.actionType, operation.actionType);
            assert.equal(payload.params.childSessionId, sessionId);
            assert.equal(payload.params.branchName, branchName);
            assert.equal(payload.params.worktreePathHash, createHash('sha256').update(worktreePath).digest('hex'));
            assert.equal(payload.params.executionId, execution.id);
            assert.equal(payload.params.dispatchToken, execution.dispatchToken);
            assert.equal(payload.params.version, 2);
            operationDeliveries++; return { accepted: true };
        } };
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-decision`, operationRpc);
    await Promise.all(Array.from({ length: 4 }, () => decisionOutboxTick(new Date(), owner)));
    await decisionOutboxTick(new Date(), owner);
    assert.equal(operationDeliveries, 1);
    assert.equal((await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: op2.body.id } })).status, 'pending');
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: { branchName: branchName+'-changed' } });
    assert.equal((await call(owner, `/decisions/${op2.body.id}/respond`, 'POST', {
        ...reply, clientRequestId: tag+'approve-op2' })).status, 409);
    assert.equal((await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: op2.body.id } })).status, 'pending');
    assert.equal(operationDeliveries, 1);
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: { branchName } });
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-decision`, rpc);
    console.log('REAL_DB_HTTP_OPERATION_DECISIONS_HASH_CONFLICT_SINGLE_USE_AND_WORKSPACE_IDENTITY_FENCE_OK');
    const expiredRequest = await call(owner, requestPath, 'POST', { ...input, kind: 'review' });
    assert.equal(expiredRequest.status, 201);
    await db.aiDecisionRequest.update({ where: { id: expiredRequest.body.id }, data: { expiresAt: new Date(Date.now()-1000) } });
    assert.equal((await call(owner, `/decisions/${expiredRequest.body.id}/respond`, 'POST', reply)).status, 409);
    await decisionOutboxTick(new Date(), owner);
    assert.equal((await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: expiredRequest.body.id } })).status, 'expired');
    assert.equal(deliveries, 2, 'Expired pending decision reached runtime');
    const revokeExecution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId, provider: 'codex', status: 'running', attempt: 2, dispatchToken: randomUUID() } });
    const revokeCap = await issueExecutionCapability({ accountId: owner, executionId: revokeExecution.id,
        allowedOps: ['decision_request'], expiresAt: new Date(Date.now()+60000) });
    const revokedDecision = await call(owner, `/executions/${revokeExecution.id}/decisions`, 'POST', { ...input, capability: revokeCap.token });
    assert.equal(revokedDecision.status, 201);
    assert.equal((await call(admin, `/decisions/${revokedDecision.body.id}/respond`, 'POST', { ...reply, clientRequestId: tag+'revoked' })).status, 200);
    const deleted = await fetch(`${base}/v1/ai-team/workspaces/${workspace.id}/members/${admin}`, {
        method: 'DELETE', headers: { 'x-fixture-account': owner }, signal: AbortSignal.timeout(15000) });
    assert.equal(deleted.status, 204);
    await decisionOutboxTick(new Date(), owner);
    const blockedRevoke = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: revokedDecision.body.id } });
    assert.equal(blockedRevoke.deliveryStatus, 'blocked'); assert.equal(blockedRevoke.errorCode, 'approver_revoked');
    assert.equal(deliveries, 2, 'Revoked approver decision reached runtime');
    console.log('REAL_DB_HTTP_DECISION_EXPIRY_AND_REVOKED_APPROVER_NO_RUNTIME_WAKE_OK');

    // A Team WorkItem points to aggregate, while approvals can originate from
    // a member execution in that same run. Preserve both identities.
    const teamRun = await db.orchestratorRun.create({ data: { accountId: owner, title: tag+'team', status: 'running',
        tasks: { create: [{ seq: 1, taskKey: 'member', provider: 'codex', prompt: 'Owned member', status: 'running', collaborationRole: 'member' },
            { seq: 2, taskKey: 'aggregate', provider: 'codex', prompt: 'Owned aggregate', status: 'queued', collaborationRole: 'aggregate' }] } }, include: { tasks: true } });
    const memberTask = teamRun.tasks.find((t: any) => t.taskKey === 'member')!;
    const aggregateTask = teamRun.tasks.find((t: any) => t.taskKey === 'aggregate')!;
    const memberExecution = await db.orchestratorExecution.create({ data: { runId: teamRun.id, taskId: memberTask.id,
        machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    await db.aiWorkItem.create({ data: { accountId: owner, title: tag+'team', summary: 'Owned Team fixture', sourceType: 'execution',
        sourceLabel: 'Owned fixture', sourceResourceId: tag+'team', assigneeId: agent.id, conversationId: conversation.id,
        orchestratorRunId: teamRun.id, orchestratorTaskId: aggregateTask.id } });
    const memberCap = await issueExecutionCapability({ accountId: owner, executionId: memberExecution.id,
        allowedOps: ['decision_request'], expiresAt: new Date(Date.now()+60000) });
    const memberDecision = await call(owner, `/executions/${memberExecution.id}/decisions`, 'POST', { ...input, capability: memberCap.token });
    assert.equal(memberDecision.status, 201);
    assert.equal((await call(owner, `/decisions/${memberDecision.body.id}/respond`, 'POST', { ...reply, clientRequestId: tag+'member' })).status, 200);
    let memberDeliveries = 0;
    const memberRpc: any = { connected: true, timeout: () => memberRpc, emitWithAck: async (_event: string, payload: any) => {
        assert.equal(payload.params.executionId, memberExecution.id); assert.equal(payload.params.dispatchToken, memberExecution.dispatchToken);
        memberDeliveries++; return { accepted: true };
    } };
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-decision`, memberRpc);
    await decisionOutboxTick(new Date(), owner);
    const memberResult = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: memberDecision.body.id } });
    console.log(JSON.stringify({ result: 'REAL_DB_TEAM_MEMBER_DECISION_OUTBOX', deliveryStatus: memberResult.deliveryStatus,
        errorCode: memberResult.errorCode, memberDeliveries }));
    assert.equal(memberResult.deliveryStatus, 'delivered', 'Team member decision incorrectly requires WorkItem aggregate task identity');
    assert.equal(memberDeliveries, 1);
    console.log('REAL_DB_HTTP_TEAM_MEMBER_DECISION_RESUMES_ORIGINAL_MEMBER_EXECUTION_OK');

    // Approval is not an indefinite permission. Let a genuinely short-lived
    // operation expire after approval, before a connected runtime consumes it.
    const expiry = new Date(Date.now() + 1800);
    // The preceding admin-removal case revoked older capabilities. Mint this
    // separate operation's capability for the still-running execution under
    // the current revision; do not bypass or reuse a revoked capability.
    const expiringCap = await issueExecutionCapability({ accountId: owner, executionId: execution.id,
        allowedOps: ['decision_request'], expiresAt: new Date(Date.now() + 60000) });
    const expiring = await call(owner, requestPath, 'POST', { ...operation,
        capability: expiringCap.token, operationId: tag+'approved-expiring', expiresAt: expiry.toISOString() });
    assert.equal(expiring.status, 201);
    assert.equal((await call(owner, `/decisions/${expiring.body.id}/respond`, 'POST', {
        ...reply, clientRequestId: tag+'approve-expiring' })).status, 200);
    let expiredDeliveries = 0;
    const expiredRpc: any = { connected: true, timeout: () => expiredRpc,
        emitWithAck: async (_event: string, payload: any) => {
            assert.equal(payload.params.decisionId, expiring.body.id);
            expiredDeliveries++; return { accepted: true };
        } };
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-decision`, expiredRpc);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry.getTime() - Date.now() + 150)));
    await decisionOutboxTick(new Date(), owner);
    const expiredApproved = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: expiring.body.id } });
    console.log(JSON.stringify({ result: 'REAL_DB_APPROVED_OPERATION_EXPIRES_BEFORE_RUNTIME_DELIVERY',
        expiredDeliveries, deliveryStatus: expiredApproved.deliveryStatus, status: expiredApproved.status }));
    assert.equal(expiredDeliveries, 0, 'Approved operation woke runtime after its actual expiry');
    assert.notEqual(expiredApproved.deliveryStatus, 'delivered');
    console.log('REAL_DB_HTTP_APPROVED_OPERATION_EXPIRY_BEFORE_DELIVERY_NO_RUNTIME_WAKE_OK');

} finally {
    await app.close();
    for (const id of accounts) getOrCreateUserRpcListeners(id).clear();
    await db.aiDecisionRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiWorkspace.deleteMany({ where: { ownerAccountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `decision-real-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
