import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { redis } from '../packages/happy-server/sources/storage/redis';

// Actual DB/HTTP acceptance versus resume. A test-only read barrier pauses
// the returned real DB snapshot; it supplies no fake DB values. Delivery status
// is an owned fixture, not real GitHub verification. No daemon is started.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const accounts: string[] = [];
const resumedCompleted = process.argv.includes('--resumed-completed');
app.decorate('authenticate', async (request: any, reply: any) => {
    const id = request.headers['x-fixture-account'];
    if (!accounts.includes(id)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = id;
});
let releaseRead: (() => void) | undefined;
let restoreRead: (() => void) | undefined;
let approval: Promise<Response> | undefined;
try {
    const owner = (await db.account.create({ data: { publicKey: `acceptance-race-${tag}` } })).id; accounts.push(owner);
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner, agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'completed',
        tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex', prompt: 'Owned fixture', status: 'completed' } } }, include: { tasks: true } });
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId: randomUUID(), provider: 'codex', status: 'completed', childSessionId: randomUUID(), dispatchToken: randomUUID() } });
    const work = await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned fixture', sourceType: 'execution',
        sourceLabel: 'Owned fixture', sourceResourceId: tag, assigneeId: agent.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id,
        deliveryVerificationStatus: 'verified', deliveryVerifiedAt: new Date() } });
    aiTeamRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (body: unknown) => fetch(`${base}/v1/ai-team/work-items/${work.id}/acceptance`, {
        method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'x-fixture-account': owner, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let observed!: () => void;
    const readObserved = new Promise<void>(resolve => { observed = resolve; });
    const held = new Promise<void>(resolve => { releaseRead = resolve; });
    const originalRead = db.aiWorkItem.findFirst;
    let paused = false;
    (db.aiWorkItem as any).findFirst = async (args: any) => {
        const actual = await originalRead.call(db.aiWorkItem, args);
        if (!paused && args?.where?.id === work.id && args.include?.orchestratorRun) {
            paused = true; observed(); await held;
        }
        return actual;
    };
    restoreRead = () => { (db.aiWorkItem as any).findFirst = originalRead; };
    approval = post({ status: 'approved', note: 'Approve old result' });
    await Promise.race([readObserved, new Promise((_,reject)=>setTimeout(()=>reject(new Error('Acceptance read barrier not reached')),5000))]);
    const revision = await post({ status: 'changes_requested', note: 'Revise the previous result', clientMessageId: tag });
    assert.equal(revision.status, 200, 'Actual changes_requested route did not resume');
    assert.equal((await db.orchestratorTask.findUniqueOrThrow({ where: { id: run.tasks[0].id } })).status, 'queued');
    assert.equal(await db.orchestratorExecution.count({ where: { taskId: run.tasks[0].id } }), 2);
    if (resumedCompleted) {
        // Simulate a fast revised execution becoming verifiable before the old
        // reviewer request resumes. These are owned completion/delivery fixtures,
        // not provider execution or GitHub verification. The reviewed snapshot
        // is still the previous result and must not approve this new revision.
        const resumed = await db.orchestratorExecution.findFirstOrThrow({
            where: { taskId: run.tasks[0].id, id: { not: execution.id } } });
        await db.orchestratorExecution.update({ where: { id: resumed.id }, data: { status: 'completed' } });
        await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'completed' } });
        await db.orchestratorRun.update({ where: { id: run.id }, data: { status: 'completed' } });
        await db.aiWorkItem.update({ where: { id: work.id }, data: {
            deliveryVerificationStatus: 'verified', deliveryVerifiedAt: new Date() } });
    }
    releaseRead(); restoreRead();
    const approved = await approval;
    const after = await db.aiWorkItem.findUniqueOrThrow({ where: { id: work.id } });
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_ACCEPTANCE_RESUME_RACE', approvalStatus: approved.status,
        acceptanceStatus: after.acceptanceStatus, resumedExecutionCount: 2,
        resumedCompleted }));
    assert.equal(approved.status, 409, 'Stale acceptance succeeded after actual resume committed');
    assert.equal(after.acceptanceStatus, 'changes_requested');
    assert.equal(await db.orchestratorRun.count({ where: { accountId: owner } }), 1);
    console.log('REAL_DB_HTTP_STALE_ACCEPTANCE_CANNOT_APPROVE_RESUMED_WORK_OK');
    if (resumedCompleted) {
        // An old browser page can submit a fresh request after the revision has
        // already completed. Server request-time CAS alone cannot protect it.
        const revised = await db.orchestratorExecution.findFirstOrThrow({
            where: { taskId: run.tasks[0].id }, orderBy: { attempt: 'desc' } });
        assert.notEqual(revised.id, execution.id);
        assert.equal((await post({ status: 'approved', reviewedExecutionId: execution.id,
            note: 'Fresh request from stale browser page' })).status, 409);
        assert.equal((await post({ status: 'approved', note: 'Legacy page omitted revision identity' })).status, 409);
        assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: work.id } })).acceptanceStatus, 'changes_requested');
        assert.equal((await post({ status: 'approved', reviewedExecutionId: revised.id,
            note: 'Reviewed the actual new result' })).status, 200);
        assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: work.id } })).acceptanceStatus, 'approved');
        console.log('REAL_DB_HTTP_CLIENT_REVIEWED_EXECUTION_STALE_REJECT_NEW_ACCEPT_OK');
    }
} finally {
    releaseRead?.(); restoreRead?.(); await approval?.catch(() => {});
    await app.close();
    await db.aiInboundRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: `acceptance-race-${tag}` } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
