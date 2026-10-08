import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { aiDecisionRoutes } from '../packages/happy-server/sources/app/api/routes/aiDecisionRoutes';
import { decisionOutboxTick } from '../packages/happy-server/sources/app/ai/decisionOutbox';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { issueExecutionCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';

// Real HTTP approval/revocation and real PostgreSQL outbox. The read barrier
// delays an actual membership result; it does not fabricate authorization.
// RPC acknowledgement and authentication are fixtures, not CLI recovery.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const accounts: string[] = [];
const leaseExpired = process.argv.includes('--lease-expired');
const ackLeaseExpired = process.argv.includes('--ack-lease-expired');
const dispatchReadLeaseExpired = process.argv.includes('--dispatch-read-lease-expired');
assert.ok([leaseExpired, ackLeaseExpired, dispatchReadLeaseExpired].filter(Boolean).length <= 1, 'Select one lease timing mode');
app.decorate('authenticate', async (request: any, reply: any) => {
    const accountId = request.headers['x-fixture-account'];
    if (!accounts.includes(accountId)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = accountId;
});
let releaseRead: (() => void) | undefined;
let restoreRead: (() => void) | undefined;
let restoreTransaction: (() => void) | undefined;
let tick: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({
        data: { publicKey: `decision-revoke-race-${tag}-${i}` } })).id);
    const [owner, admin] = accounts;
    aiWorkspaceRoutes(app); aiDecisionRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = async (accountId: string, path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, { method,
            signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': accountId,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
    };
    const workspace = (await call(owner, '/workspaces')).body.items.find((row: any) => row.ownerAccountId === owner);
    const memberPath = `/workspaces/${workspace.id}/members/${admin}`;
    assert.equal((await call(owner, memberPath, 'PUT', { role: 'admin' })).status, 200);
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag,
        role: 'Fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner,
        agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex', prompt: 'Owned fixture', status: 'running' } } },
        include: { tasks: true } });
    const machineId = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned fixture',
        sourceType: 'execution', sourceLabel: 'Owned fixture', sourceResourceId: tag,
        assigneeId: agent.id, conversationId: conversation.id, orchestratorRunId: run.id,
        orchestratorTaskId: run.tasks[0].id } });
    const capability = await issueExecutionCapability({ accountId: owner, executionId: execution.id,
        allowedOps: ['decision_request'], expiresAt: new Date(Date.now() + 60000) });
    const requested = await call(owner, `/executions/${execution.id}/decisions`, 'POST', {
        machineId, capability: capability.token, kind: 'approval', summary: 'Owned bounded operation',
        expiresAt: new Date(Date.now() + 60000).toISOString() });
    assert.equal(requested.status, 201);
    assert.equal((await call(admin, `/decisions/${requested.body.id}/respond`, 'POST', {
        version: 1, clientRequestId: tag, decision: 'approved', note: 'Owned review' })).status, 200);
    let deliveries = 0;
    const rpc: any = { connected: true, timeout: () => rpc,
        emitWithAck: async (_event: string, payload: any) => {
            assert.equal(payload.params.executionId, execution.id);
            assert.equal(payload.params.dispatchToken, execution.dispatchToken);
            deliveries++;
            if (ackLeaseExpired) {
                const current = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: requested.body.id } });
                assert.ok(current.leaseUntil && current.leaseUntil.getTime() > Date.now());
                await new Promise(resolve => setTimeout(resolve, Math.max(0, current.leaseUntil!.getTime() - Date.now() + 150)));
            }
            return { accepted: true };
        } };
    getOrCreateUserRpcListeners(owner).set(`${machineId}:orchestrator-decision`, rpc);
    let observed!: () => void;
    const readObserved = new Promise<void>(resolve => { observed = resolve; });
    const held = new Promise<void>(resolve => { releaseRead = resolve; });
    const originalRead = db.aiWorkspaceMembership.findUnique;
    let paused = false;
    (db.aiWorkspaceMembership as any).findUnique = async (args: any) => {
        const actual = await originalRead.call(db.aiWorkspaceMembership, args);
        if (!paused && args?.where?.workspaceId_memberAccountId?.workspaceId === workspace.id
            && args.where.workspaceId_memberAccountId.memberAccountId === admin) {
            assert.equal(actual?.role, 'admin'); paused = true; observed(); await held;
        }
        return actual;
    };
    restoreRead = () => { (db.aiWorkspaceMembership as any).findUnique = originalRead; };
    if (dispatchReadLeaseExpired) {
        const transaction = db.$transaction;
        (db as any).$transaction = (action: any, options: any) => transaction.call(db, async (tx: any) => {
            const findExecution = tx.orchestratorExecution.findFirst;
            tx.orchestratorExecution.findFirst = async (args: any) => {
                const actual = await findExecution.call(tx.orchestratorExecution, args);
                if (args?.where?.id === execution.id && args.select?.dispatchToken) {
                    const claimed = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: requested.body.id } });
                    assert.ok(claimed.leaseUntil && claimed.leaseUntil.getTime() > Date.now());
                    await new Promise(resolve => setTimeout(resolve, Math.max(0, claimed.leaseUntil!.getTime() - Date.now() + 150)));
                }
                return actual;
            };
            return action(tx);
        }, options);
        restoreTransaction = () => { (db as any).$transaction = transaction; };
    }
    tick = decisionOutboxTick(new Date(), owner);
    await Promise.race([readObserved, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Actual outbox membership barrier was not reached')), 5000);
    })]);
    clearTimeout(timer);
    if (leaseExpired || ackLeaseExpired || dispatchReadLeaseExpired) {
        const claimed = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: requested.body.id } });
        assert.equal(claimed.deliveryStatus, 'processing'); assert.ok(claimed.claimOwner);
        assert.ok(claimed.leaseUntil && claimed.leaseUntil.getTime() > Date.now());
        // Actual expiry with owner unchanged and no replacement worker. This
        // pauses the pre-transaction read, so it cannot expire a tx timeout.
        // ACK mode leaves eight seconds for the real RPC to start under a valid
        // claim, then waits naturally across expiry inside the 25s transaction.
        await new Promise(resolve => setTimeout(resolve, Math.max(0,
            claimed.leaseUntil!.getTime() - Date.now() + (ackLeaseExpired || dispatchReadLeaseExpired ? -8000 : 150))));
    } else {
        assert.equal((await call(owner, memberPath, 'DELETE')).status, 204);
        assert.equal(await db.aiWorkspaceMembership.count({ where: { workspaceId: workspace.id, memberAccountId: admin } }), 0);
    }
    releaseRead(); restoreRead(); await tick; restoreTransaction?.();
    const after = await db.aiDecisionRequest.findUniqueOrThrow({ where: { id: requested.body.id } });
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_DECISION_REVOKE_DURING_OUTBOX',
        leaseExpired, ackLeaseExpired, dispatchReadLeaseExpired, deliveries, deliveryStatus: after.deliveryStatus, errorCode: after.errorCode }));
    assert.equal(deliveries, ackLeaseExpired ? 1 : 0, leaseExpired || dispatchReadLeaseExpired
        ? 'Outbox woke runtime after its claim lease naturally expired'
        : 'Outbox woke runtime using authorization read before a committed revocation');
    if (leaseExpired || ackLeaseExpired || dispatchReadLeaseExpired) {
        assert.notEqual(after.deliveryStatus, 'delivered');
        assert.equal(after.errorCode, 'claim_expired');
        console.log(dispatchReadLeaseExpired ? 'REAL_DB_HTTP_DECISION_OUTBOX_LAST_DB_READ_LEASE_EXPIRY_NO_RUNTIME_WAKE_OK'
            : ackLeaseExpired ? 'REAL_DB_HTTP_DECISION_OUTBOX_ACK_AFTER_NATURAL_LEASE_EXPIRY_FENCED_OK'
            : 'REAL_DB_HTTP_DECISION_OUTBOX_NATURAL_LEASE_EXPIRY_NO_RUNTIME_WAKE_OK');
    } else {
        assert.equal(after.deliveryStatus, 'blocked'); assert.equal(after.errorCode, 'approver_revoked');
        console.log('REAL_DB_HTTP_DECISION_OUTBOX_REVOKE_RACE_NO_RUNTIME_WAKE_OK');
    }
} finally {
    clearTimeout(timer); releaseRead?.(); restoreRead?.(); await tick?.catch(() => {}); restoreTransaction?.();
    await app.close();
    for (const accountId of accounts) getOrCreateUserRpcListeners(accountId).clear();
    await db.aiDecisionRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiWorkspace.deleteMany({ where: { ownerAccountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `decision-revoke-race-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
