import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { aiWorkItemCollaborationRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkItemCollaborationRoutes';
import { AiWorkItemMetadataSchema, AiWorkItemCommentResultSchema,
    AiWorkItemCommentsSchema, AiWorkItemNotificationsSchema } from 'happy-wire';

// Actual HTTP/PostgreSQL concurrency; authentication and initial WorkItems are
// owned fixtures. This does not claim browser, provider or notification delivery.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `work-collaboration-${randomUUID()}`;
const accounts: string[] = []; const runs: string[] = [];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && ['--revoke-during-read', '--notification-revoke-during-read'].includes(args[0]));
const originalTransaction = db.$transaction.bind(db);
let releaseRead: (() => void) | undefined; let pending: Promise<Response> | undefined;
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 3; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    const [owner, member, outsider] = accounts;
    aiWorkspaceRoutes(app); aiWorkItemCollaborationRoutes(app);
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
    const project = await db.aiProject.create({ data: { accountId: owner, name: tag, clientRequestId: tag } });
    const works = [];
    for (let i = 0; i < 3; i++) {
        const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'completed',
            tasks: { create: { seq: 1, taskKey: `work-${i}`, provider: 'codex', prompt: '', status: 'completed' } } }, include: { tasks: true } });
        runs.push(run.id);
        works.push(await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned collaboration fixture',
            sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id, assigneeId: agent.id,
            conversationId: conversation.id, orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id,
            ...(i === 2 ? { projectId: project.id, projectVersion: 1 } : {}) } }));
    }
    const path = `/work-items/${works[0].id}`;
    assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'PUT', { role: 'member' })).status, 200);
    const grant = (canRun: boolean) => call(owner, `/workspaces/${workspace.id}/grants`, 'PUT', {
        memberAccountId: member, resourceKind: 'agent', resourceId: agent.id, canView: true, canRun, canApprove: false });
    assert.equal((await grant(false)).status, 200);
    assert.equal((await call(member, `${path}/metadata`)).status, 200);
    assert.equal((await call(member, `${path}/metadata`, 'PATCH', { expectedRevision: 1, priority: 'urgent' })).status, 404);
    assert.equal((await call(member, `${path}/comments`, 'POST', { clientRequestId: 'blocked', body: 'blocked' })).status, 404);
    const subscriptions = await Promise.all(Array.from({ length: 4 }, () => call(member, `${path}/subscription`, 'PUT')));
    assert.deepEqual(subscriptions.map(row => row.status), [200, 200, 200, 200]);
    assert.equal(await db.aiWorkItemSubscription.count({ where: { workItemId: works[0].id } }), 1);
    assert.equal(await db.aiWorkItemAudit.count({ where: { workItemId: works[0].id, action: 'subscribed' } }), 1);
    assert.equal((await grant(true)).status, 200);
    const edits = await Promise.all(['high', 'urgent'].map(priority => call(member, `${path}/metadata`, 'PATCH', {
        expectedRevision: 1, priority, labels: ['Review'], dueDate: '2026-11-01T00:00:00.000Z' })));
    assert.deepEqual(edits.map(row => row.status).sort(), [200, 409]);
    const metadata = await (await call(member, `${path}/metadata`)).json() as any;
    AiWorkItemMetadataSchema.parse(metadata);
    assert.equal(metadata.metadataRevision, 2); assert.deepEqual(metadata.labels, ['Review']);
    assert.equal(await db.aiWorkItemAudit.count({ where: { workItemId: works[0].id, action: 'metadata_updated' } }), 1);
    const noChange = await call(member, `${path}/metadata`, 'PATCH', { expectedRevision: 2, priority: metadata.priority });
    assert.equal(noChange.status, 200); assert.equal((await noChange.json() as any).duplicate, true);
    assert.equal((await call(member, `${path}/metadata`, 'PATCH', { expectedRevision: 2, labels: ['x', ' X '] })).status, 400);
    const comments = await Promise.all(Array.from({ length: 4 }, () => call(member, `${path}/comments`, 'POST', {
        clientRequestId: 'same-request', body: 'Owned identical comment' })));
    assert.deepEqual(comments.map(row => row.status).sort(), [200, 200, 200, 201]);
    const commentBodies = await Promise.all(comments.map(row => row.json() as Promise<any>));
    commentBodies.forEach(body => AiWorkItemCommentResultSchema.parse(body));
    assert.equal(new Set(commentBodies.map(row => row.id)).size, 1);
    assert.equal((await call(member, `${path}/comments`, 'POST', { clientRequestId: 'same-request', body: 'Changed body' })).status, 409);
    assert.equal((await call(owner, `${path}/comments`, 'POST', { clientRequestId: 'same-request', body: 'Owner distinct actor' })).status, 201);
    assert.equal(await db.aiWorkItemComment.count({ where: { workItemId: works[0].id } }), 2);
    assert.equal(await db.aiWorkItemAudit.count({ where: { workItemId: works[0].id, action: 'comment_added' } }), 2);
    // Only another actor's comment should notify the subscribed member, and
    // replayed writes must not duplicate its persistent notification.
    const notificationsPath = '/notifications';
    const notificationList = await call(member, notificationsPath);
    assert.equal(notificationList.status, 200);
    const notificationBody = await notificationList.json() as any;
    AiWorkItemNotificationsSchema.parse(notificationBody);
    assert.equal(notificationBody.items.length, 1);
    const notification = notificationBody.items[0];
    assert.equal(notification.workItemId, works[0].id);
    assert.equal(notification.action, 'comment_added'); assert.equal(notification.actorAccountId, owner);
    assert.equal(notification.readAt, null);
    assert.ok(!JSON.stringify(notification).includes('Owner distinct actor'), 'Notification exposed comment body');
    assert.equal(await db.aiWorkItemNotification.count({ where: { recipientAccountId: member } }), 1);
    assert.equal((await call(outsider, notificationsPath)).status, 200);
    assert.equal((await (await call(outsider, notificationsPath)).json() as any).items.length, 0);
    assert.equal((await call(outsider, `${notificationsPath}/${notification.id}/read`, 'POST', {})).status, 404);
    assert.equal((await call(outsider, `${notificationsPath}?cursor=${notification.id}`)).status, 400);
    const readResults = await Promise.all(Array.from({ length: 4 }, () =>
        call(member, `${notificationsPath}/${notification.id}/read`, 'POST', {})));
    assert.ok(readResults.every(row => row.status === 200));
    const readAt = (await db.aiWorkItemNotification.findUniqueOrThrow({ where: { id: notification.id } })).readAt;
    assert.ok(readAt);
    assert.equal((await call(member, `${notificationsPath}/${notification.id}/read`, 'POST', {})).status, 200);
    assert.equal((await db.aiWorkItemNotification.findUniqueOrThrow({ where: { id: notification.id } })).readAt?.getTime(), readAt.getTime());
    const other = await call(owner, `/work-items/${works[1].id}/comments`, 'POST', { clientRequestId: 'other', body: 'Other work' });
    assert.equal(other.status, 201); const otherId = (await other.json() as any).id;
    assert.equal((await call(member, `${path}/comments?cursor=${otherId}`)).status, 400);
    const firstPage = await (await call(member, `${path}/comments?limit=1`)).json() as any;
    const secondPage = await (await call(member, `${path}/comments?limit=1&cursor=${firstPage.nextCursor}`)).json() as any;
    AiWorkItemCommentsSchema.parse(firstPage);
    AiWorkItemCommentsSchema.parse(secondPage);
    assert.equal(firstPage.items.length, 1); assert.equal(secondPage.items.length, 1);
    assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
    const projectPath = `/work-items/${works[2].id}`;
    for (const endpoint of ['metadata', 'comments', 'audit']) assert.equal((await call(member, `${projectPath}/${endpoint}`)).status, 404);
    assert.equal((await call(member, `${projectPath}/subscription`, 'PUT')).status, 404);
    const projectGrant = (canView: boolean, canRun: boolean) => call(owner, `/workspaces/${workspace.id}/grants`, 'PUT', {
        memberAccountId: member, resourceKind: 'project', resourceId: project.id, canView, canRun, canApprove: false });
    assert.equal((await projectGrant(true, false)).status, 200);
    for (const endpoint of ['metadata', 'comments', 'audit']) assert.equal((await call(member, `${projectPath}/${endpoint}`)).status, 200);
    assert.equal((await call(member, `${projectPath}/comments`, 'POST', { clientRequestId: 'project-blocked', body: 'blocked' })).status, 404);
    assert.equal((await call(member, `${projectPath}/metadata`, 'PATCH', { expectedRevision: 1, priority: 'high' })).status, 404);
    assert.equal((await call(member, `${projectPath}/subscription`, 'PUT')).status, 200);
    assert.equal((await projectGrant(true, true)).status, 200);
    assert.equal((await call(member, `${projectPath}/comments`, 'POST', { clientRequestId: 'project-allowed', body: 'Dual grant comment' })).status, 201);
    assert.equal((await call(member, `${projectPath}/metadata`, 'PATCH', { expectedRevision: 1, priority: 'high' })).status, 200);
    assert.equal((await projectGrant(false, false)).status, 200);
    for (const endpoint of ['metadata', 'comments', 'audit']) assert.equal((await call(member, `${projectPath}/${endpoint}`)).status, 404);
    assert.equal((await call(member, `${projectPath}/subscription`, 'DELETE')).status, 404);
    assert.equal(await db.aiWorkItemComment.count({ where: { workItemId: works[2].id } }), 1);
    assert.equal(await db.aiWorkItemSubscription.count({ where: { workItemId: works[2].id } }), 1);
    for (const endpoint of ['metadata', 'comments', 'audit']) assert.equal((await call(outsider, `${path}/${endpoint}`)).status, 404);
    assert.equal((await call(outsider, `${path}/subscription`, 'PUT')).status, 404);
    const deletes = await Promise.all(Array.from({ length: 4 }, () => call(member, `${path}/subscription`, 'DELETE')));
    assert.ok(deletes.every(row => row.status === 200));
    assert.equal(await db.aiWorkItemSubscription.count({ where: { workItemId: works[0].id } }), 0);
    assert.equal(await db.aiWorkItemAudit.count({ where: { workItemId: works[0].id, action: 'unsubscribed' } }), 1);
    assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'DELETE')).status, 204);
    for (const endpoint of ['metadata', 'comments', 'audit']) assert.equal((await call(member, `${path}/${endpoint}`)).status, 404);
    assert.equal((await call(member, `${path}/subscription`, 'PUT')).status, 404);
    assert.equal((await (await call(member, notificationsPath)).json() as any).items.length, 0);
    assert.equal((await call(member, `${notificationsPath}/${notification.id}/read`, 'POST', {})).status, 404);
    assert.equal(await db.aiWorkItemNotification.count({ where: { recipientAccountId: member } }), 1,
        'Revocation deleted retained notification audit');
    console.log('REAL_DB_HTTP_SUBSCRIPTION_NOTIFICATION_NO_SELF_DUPLICATE_BODY_READ_REPLAY_AND_REVOKE_OK');
    assert.equal((await call(member, `${path}/comments`, 'POST', { clientRequestId: 'revoked', body: 'blocked' })).status, 404);
    assert.equal((await call(member, `${path}/metadata`, 'PATCH', { expectedRevision: 2, priority: 'low' })).status, 404);
    if (args.includes('--notification-revoke-during-read')) {
        const outcomes = [];
        for (const method of ['GET', 'POST'] as const) {
            assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'PUT', { role: 'member' })).status, 200);
            assert.equal((await grant(true)).status, 200);
            let observed!: () => void;
            const observedRead = new Promise<void>(resolve => { observed = resolve; });
            const held = new Promise<void>(resolve => { releaseRead = resolve; });
            let paused = false;
            (db as any).$transaction = (fn: any, options: any) => typeof fn !== 'function'
                ? originalTransaction(fn, options)
                : originalTransaction(async (tx: any) => fn(new Proxy(tx, { get(target, key) {
                    if (key !== 'aiWorkItemNotification') {
                        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
                    }
                    return new Proxy(target.aiWorkItemNotification, { get(model, operation) {
                        const value = model[operation];
                        if (operation !== (method === 'GET' ? 'findMany' : 'findFirst'))
                            return typeof value === 'function' ? value.bind(model) : value;
                        return async (query: any) => {
                            const actual = await value.call(model, query);
                            if (!paused && query.where?.recipientAccountId === member) {
                                paused = true; observed(); await held;
                            }
                            return actual;
                        };
                    } });
                } })), options);
            pending = call(member, method === 'GET' ? notificationsPath : `${notificationsPath}/${notification.id}/read`,
                method, method === 'POST' ? {} : undefined);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([observedRead, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Actual notification read barrier not reached')), 3000);
            })]); } finally { if (timer) clearTimeout(timer); }
            assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'DELETE')).status, 204);
            releaseRead(); (db as any).$transaction = originalTransaction;
            const result = await pending; pending = undefined;
            assert.equal(result.status, method === 'GET' ? 200 : 404);
            if (method === 'GET') assert.deepEqual((await result.json() as any).items, []);
            assert.equal((await db.aiWorkItemNotification.findUniqueOrThrow({ where: { id: notification.id } })).readAt?.getTime(), readAt.getTime());
            outcomes.push({ method, status: result.status });
        }
        console.log(JSON.stringify({ result: 'REAL_NOTIFICATION_REVOKE_AFTER_ACTUAL_READ_NO_DISCLOSURE_OR_WRITE', outcomes }));
    }
    if (args.includes('--revoke-during-read')) {
        const outcomes = [];
        for (const [endpoint, method, body] of [
            ['metadata', 'PATCH', { expectedRevision: 2, priority: 'low' }],
            ['comments', 'POST', { clientRequestId: 'revoke-race', body: 'must not commit' }],
            ['subscription', 'PUT', undefined],
        ] as const) {
            assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'PUT', { role: 'member' })).status, 200);
            assert.equal((await grant(true)).status, 200);
            let observed!: () => void;
            const readObserved = new Promise<void>(resolve => { observed = resolve; });
            const held = new Promise<void>(resolve => { releaseRead = resolve; });
            let paused = false;
            (db as any).$transaction = (fn: any, options: any) => typeof fn !== 'function'
                ? originalTransaction(fn, options)
                : originalTransaction(async (tx: any) => fn(new Proxy(tx, { get(target, key) {
                    if (key !== 'aiWorkItem') { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; }
                    return new Proxy(target.aiWorkItem, { get(model, method) {
                        const value = model[method];
                        if (method !== 'findUnique') return typeof value === 'function' ? value.bind(model) : value;
                        return async (query: any) => {
                            const actual = await value.call(model, query);
                            if (!paused && query.where?.id === works[0].id) { paused = true; observed(); await held; }
                            return actual;
                        };
                    } });
                } })), options);
            pending = call(member, `${path}/${endpoint}`, method, body);
            let barrierTimer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([readObserved, new Promise((_, reject) => {
                    barrierTimer = setTimeout(() => reject(new Error('Actual authorization read barrier not reached')), 3000);
                })]);
            } finally { if (barrierTimer) clearTimeout(barrierTimer); }
            assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'DELETE')).status, 204);
            releaseRead(); (db as any).$transaction = originalTransaction;
            const response = await pending; pending = undefined;
            assert.equal(response.status, 404, `Revoked member committed ${endpoint}`);
            assert.equal(await db.aiWorkItemAudit.count({ where: { workItemId: works[0].id } }), 5);
            assert.equal(await db.aiWorkItemComment.count({ where: { workItemId: works[0].id } }), 2);
            assert.equal(await db.aiWorkItemSubscription.count({ where: { workItemId: works[0].id } }), 0);
            assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: works[0].id } })).metadataRevision, 2);
            outcomes.push({ endpoint, httpStatus: response.status });
        }
        console.log(JSON.stringify({ result: 'REAL_DB_HTTP_WORK_COLLABORATION_REVOKE_DURING_ACTUAL_READ', outcomes }));
    }
    const audit = await (await call(owner, `${path}/audit`)).json() as any;
    assert.equal(audit.items.length, 5);
    assert.ok(audit.items.every((row: any) => [owner, member].includes(row.actorAccountId)));
    console.log('REAL_DB_HTTP_WORK_COLLABORATION_CAS_CONCURRENT_COMMENT_SUBSCRIPTION_ACTOR_CURSOR_AND_REVOKE_OK');
} finally {
    releaseRead?.(); (db as any).$transaction = originalTransaction;
    await pending?.catch(() => {});
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_WORK_COLLABORATION_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
