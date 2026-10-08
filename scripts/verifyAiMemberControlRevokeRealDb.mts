import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';

// Actual HTTP mutations and PostgreSQL. Only auth and owned runtime rows are
// fixtures. Hold an actual WorkItem read before authorization's Workspace lock,
// commit owner revocation through HTTP, then release the unchanged read result.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `member-control-${randomUUID()}`; const accounts: string[] = []; const runs: string[] = [];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && args[0] === '--commit-read');
const commitRead = args.includes('--commit-read');
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
const originalTransaction = db.$transaction.bind(db);
let releaseRead: (() => void) | undefined; let pending: Promise<Response> | undefined;
try {
    for (let i = 0; i < 3; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    const [owner, member, outsider] = accounts;
    aiTeamRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = (actor: string, path: string, method = 'GET', body?: unknown) => fetch(`${base}/v1/ai-team${path}`, {
        method, signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': actor,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const workspace = (await (await call(owner, '/workspaces')).json() as any).items.find((item: any) => item.ownerAccountId === owner);
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: 'fixture',
        description: '', emoji: '', instructions: '', settings: {} } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner, scopeKey: tag,
        kind: 'direct', agentId: agent.id, title: tag } });
    const outcomes = [];
    for (const [operation, status] of [['cancel', 'queued'], ['retry', 'failed'], ['steering', 'running'], ['acceptance', 'completed']]) {
        assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'PUT', { role: 'member' })).status, 200);
        assert.equal((await call(owner, `/workspaces/${workspace.id}/grants`, 'PUT', {
            memberAccountId: member, resourceKind: 'agent', resourceId: agent.id,
            canView: true, canRun: true, canApprove: true })).status, 200);
        const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status,
            tasks: { create: { seq: 1, taskKey: operation, provider: 'codex', prompt: '', status } } }, include: { tasks: true } });
        runs.push(run.id);
        const execution = status !== 'queued' ? await db.orchestratorExecution.create({ data: { runId: run.id,
            taskId: run.tasks[0].id, provider: 'codex', machineId: tag, status, dispatchToken: randomUUID() } }) : null;
        const work = await db.aiWorkItem.create({ data: { accountId: owner, title: tag,
            summary: 'Owned member authorization fixture', sourceType: 'execution', sourceLabel: 'fixture',
            sourceResourceId: run.id, assigneeId: agent.id, conversationId: conversation.id,
            orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id,
            ...(status === 'completed' ? { deliveryVerificationStatus: 'verified', deliveryVerifiedAt: new Date() } : {}) } });
        const path = `/work-items/${work.id}/${operation}`;
        const body = operation === 'acceptance' ? { status: 'approved', reviewedExecutionId: execution!.id,
            note: 'Owned acceptance fixture' } : { clientRequestId: `${tag}-${operation}`,
            ...(operation === 'steering' ? { text: 'Owned steering fixture' } : {}) };
        assert.equal((await call(outsider, path, 'POST', body)).status, 404);
        let observed!: () => void; const readObserved = new Promise<void>(resolve => { observed = resolve; });
        const held = new Promise<void>(resolve => { releaseRead = resolve; }); let paused = false; let matchingReads = 0;
        (db as any).$transaction = (fn: any, options: any) => typeof fn !== 'function'
            ? originalTransaction(fn, options)
            : originalTransaction(async (tx: any) => fn(new Proxy(tx, {
                get(target, key) {
                    if (key !== 'aiWorkItem') { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; }
                    return new Proxy(target.aiWorkItem, { get(model, method) {
                        const value = model[method];
                        if (method !== 'findUnique') return typeof value === 'function' ? value.bind(model) : value;
                        return async (query: any) => {
                            const actual = await value.call(model, query);
                            if (query.where?.id === work.id) matchingReads++;
                            if (!paused && matchingReads === (commitRead ? 2 : 1)) { paused = true; observed(); await held; }
                            return actual;
                        };
                    } });
                },
            })), options);
        pending = call(member, path, 'POST', body);
        await Promise.race([readObserved, new Promise((_, reject) => setTimeout(() => reject(new Error('Actual read barrier not reached')), 3000))]);
        assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'DELETE')).status, 204);
        releaseRead(); (db as any).$transaction = originalTransaction;
        const response = await pending; pending = undefined;
        const after = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id }, include: { tasks: true } });
        assert.ok([404, 409].includes(response.status), `Revoked member committed ${operation}`);
        assert.equal(after.status, status); assert.equal(after.tasks[0].status, status);
        assert.equal(await db.orchestratorExecution.count({ where: { runId: run.id } }), status === 'queued' ? 0 : 1);
        assert.equal(await db.aiSteeringMessage.count({ where: { workItemId: work.id } }), 0);
        assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: work.id } })).acceptanceStatus, 'pending');
        assert.equal(await db.aiMessage.count({ where: { conversationId: conversation.id } }), 0);
        outcomes.push({ operation, httpStatus: response.status, runStatus: after.status });
    }
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_MEMBER_CONTROL_REVOKED_DURING_READ', commitRead, outcomes }));
    console.log('REAL_DB_HTTP_MEMBER_CANCEL_RETRY_STEERING_ACCEPTANCE_REVOKE_FENCE_OK');
} finally {
    releaseRead?.(); (db as any).$transaction = originalTransaction;
    await pending?.catch(() => {}); await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_MEMBER_CONTROL_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
