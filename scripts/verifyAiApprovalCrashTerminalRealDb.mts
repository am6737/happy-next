import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { issueExecutionCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';
import { decisionOutboxTick } from '../packages/happy-server/sources/app/ai/decisionOutbox';

// Actual HTTP/DB finish and outbox. Auth and runner identity are owned fixtures;
// this proves retry/Decision fencing, not actual process termination or a UI.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `approval-crash-root-${randomUUID()}`;
const accounts: string[] = []; const runs: string[] = []; const failures: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    const owner = (await db.account.create({ data: { publicKey: tag } })).id; accounts.push(owner);
    const outsider = (await db.account.create({ data: { publicKey: `${tag}-outsider` } })).id; accounts.push(outsider);
    orchestratorRoutes(app); aiTeamRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: unknown) => fetch(`${base}/v1${path}`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: {
            'content-type': 'application/json', 'x-fixture-account': owner }, body: JSON.stringify(body),
    });
    const get = (path: string, actor = owner) => fetch(`${base}/v1/ai-team${path}`, {
        signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': actor } });
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag,
        role: 'fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner,
        agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    for (const errorCode of ['APPROVAL_SESSION_INTERRUPTED', 'APPROVAL_OUTCOME_UNCERTAIN', 'PROVIDER_TEMPORARY_UNAVAILABLE']) {
        const safetyFailure = errorCode.startsWith('APPROVAL_');
        const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag,
            status: 'running', tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex',
                prompt: '', status: 'running', permissionMode: 'approval', retryMaxAttempts: 3,
                retryBackoffMs: 0 } } }, include: { tasks: true } }); runs.push(run.id);
        const identity = { machineId: tag, childSessionId: randomUUID(),
            worktreePath: `/owned-fixture/${tag}/${run.id}`, branchName: `fixture-${run.id}` };
        const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
            taskId: run.tasks[0].id, provider: 'codex', status: 'running', attempt: 1,
            dispatchToken: randomUUID(), ...identity } });
        const work = await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned fixture',
            sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id,
            assigneeId: agent.id, conversationId: conversation.id,
            orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
        const cap = await issueExecutionCapability({ accountId: owner, executionId: execution.id,
            allowedOps: ['decision_request'], expiresAt: new Date(Date.now() + 60000) });
        const decisions: string[] = [];
        for (const index of [0, 1]) {
            const response = await post(`/ai-team/executions/${execution.id}/decisions`, {
                machineId: tag, capability: cap.token, kind: 'approval',
                summary: 'Owned bounded action', expiresAt: new Date(Date.now() + 60000).toISOString(),
                operationId: `${run.id}-${index}`, actionType: 'shell',
                actionHash: createHash('sha256').update(`${run.id}-${index}`).digest('hex'),
            });
            assert.equal(response.status, 201); decisions.push((await response.json() as any).id);
        }
        assert.equal((await post(`/ai-team/decisions/${decisions[1]}/respond`, {
            version: 1, clientRequestId: run.id, decision: 'approved', note: 'Owned approval',
        })).status, 200);
        const finishBody = { dispatchToken: execution.dispatchToken,
            childSessionId: identity.childSessionId, worktreePath: identity.worktreePath,
            branchName: identity.branchName, status: 'failed', exitCode: 1, errorCode };
        const path = `/orchestrator/executions/${execution.id}/finish`;
        assert.equal((await post(path, finishBody)).status, 200);
        assert.equal((await post(path, finishBody)).status, 200);
        assert.equal((await post(path, { ...finishBody, dispatchToken: randomUUID() })).status, 409);
        await decisionOutboxTick(new Date(), owner);
        const task = await db.orchestratorTask.findUniqueOrThrow({ where: { id: run.tasks[0].id } });
        const persistedRun = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } });
        const rows = await db.aiDecisionRequest.findMany({ where: { id: { in: decisions } } });
        const pending = rows.find(row => row.id === decisions[0])!;
        const approved = rows.find(row => row.id === decisions[1])!;
        const late = await post(`/ai-team/decisions/${decisions[0]}/respond`, {
            version: pending.version, clientRequestId: `${run.id}-late`, decision: 'approved', note: '',
        });
        const count = await db.orchestratorExecution.count({ where: { runId: run.id } });
        const workspace = await db.aiWorkspace.findUniqueOrThrow({ where: { ownerAccountId: owner } });
        const scopedPath = `/workspaces/${workspace.id}/work-items/${work.id}`;
        const scopedResponse = await get(scopedPath); assert.equal(scopedResponse.status, 200);
        const scoped = await scopedResponse.json() as any;
        assert.equal(scoped.errorCode, errorCode);
        assert.equal(scoped.orchestratorTaskId, run.tasks[0].id);
        assert.equal(scoped.orchestratorExecutionId, execution.id);
        if (safetyFailure) assert.equal(scoped.availableActions.includes('retry'), false);
        assert.equal((await get(scopedPath, outsider)).status, 404);
        const stateResponse = await get('/state'); assert.equal(stateResponse.status, 200);
        const ownerExecution = (await stateResponse.json() as any).executions.find((row: any) => row.orchestratorExecutionId === execution.id);
        assert.ok(ownerExecution); assert.equal(ownerExecution.errorCode, errorCode);
        const decisionsResponse = await get('/decisions?limit=100'); assert.equal(decisionsResponse.status, 200);
        const projectedDecisions = (await decisionsResponse.json() as any).items.filter((row: any) => decisions.includes(row.id));
        assert.equal(projectedDecisions.length, 2);
        if (safetyFailure) assert.ok(projectedDecisions.every((row: any) => row.errorCode === errorCode));
        assert.equal((await (await get('/decisions?limit=100', outsider)).json() as any).items.length, 0);
        console.log(JSON.stringify({ result: 'REAL_APPROVAL_CRASH_FINISH_RETRY_AND_DECISION_FENCE',
            errorCode, taskStatus: task.status, runStatus: persistedRun.status,
            nextAttemptScheduled: task.nextAttemptAt !== null, executionCount: count,
            pendingStatus: pending.status, pendingDelivery: pending.deliveryStatus,
            approvedDelivery: approved.deliveryStatus, lateApprovalStatus: late.status }));
        assert.equal(count, 1); assert.equal(late.status, 409);
        if (safetyFailure) {
            if (task.status !== 'failed' || task.nextAttemptAt !== null || persistedRun.status !== 'failed')
                failures.push(`${errorCode}: unsafe automatic retry scheduled`);
            if (pending.status === 'pending' || pending.deliveryStatus !== 'blocked'
                || approved.deliveryStatus !== 'blocked') failures.push(`${errorCode}: terminal Decision remains actionable`);
            assert.equal(pending.errorCode, errorCode); assert.equal(approved.errorCode, errorCode);
            assert.equal(approved.decision, 'approved'); assert.equal(approved.decidedBy, owner);
            assert.equal(pending.decision, null, 'Terminal cleanup forged a human decision');
            const manual = await Promise.all([
                post(`/ai-team/work-items/${work.id}/retry`, { clientRequestId: `${run.id}-manual-retry` }),
                post(`/orchestrator/tasks/${run.tasks[0].id}/send-message`, { message: 'Unsafe replay must be rejected' }),
            ]);
            assert.ok(manual.every(response => response.status === 409), 'Manual mutation bypassed the uncertainty fence');
            assert.equal(await db.orchestratorExecution.count({ where: { runId: run.id } }), 1);
            console.log(JSON.stringify({ result: 'REAL_APPROVAL_CRASH_MANUAL_RETRY_SEND_MESSAGE_FENCED',
                errorCode, statuses: manual.map(response => response.status) }));
        } else {
            assert.equal(task.status, 'queued', 'Ordinary configured retry was accidentally disabled');
            // Only the owned fixture is stopped at its current failed attempt
            // to inspect the ordinary manual-retry projection separately.
            await db.orchestratorTask.update({ where: { id: task.id }, data: { status: 'failed', nextAttemptAt: null } });
            await db.orchestratorRun.update({ where: { id: run.id }, data: { status: 'failed' } });
            assert.ok((await (await get(scopedPath)).json() as any).availableActions.includes('retry'));
        }
    }
    assert.equal(failures.length, 0, failures.join('; '));
    console.log('REAL_DB_HTTP_APPROVAL_CRASH_NO_AUTORETRY_TERMINAL_DECISIONS_AND_REPLAY_OK');
    console.log('REAL_DB_HTTP_APPROVAL_ERRORCODE_OWNER_SCOPED_DECISION_SAFE_ACTION_AND_TENANT_PROJECTION_OK');
} finally {
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_APPROVAL_CRASH_ROOT_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
