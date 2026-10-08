import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';
import { aiExecutionEventRoutes } from '../packages/happy-server/sources/app/api/routes/aiExecutionEventRoutes';
import { redactExpiredExecutionEvents } from '../packages/happy-server/sources/app/ai/executionEvents';

// Real PostgreSQL + Workspace/capability HTTP endpoints, fixture principal
// injection. Does not claim consumer API enforcement or CLI token delivery.
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
    for (let i = 0; i < 4; i++) accounts.push((await db.account.create({ data: { publicKey: `workspace-auth-${tag}-${i}` } })).id);
    const [owner, admin, member, outsider] = accounts;
    aiWorkspaceRoutes(app); aiExecutionEventRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = async (accountId: string, path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, { method, signal: AbortSignal.timeout(15_000),
            headers: { 'x-fixture-account': accountId,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
    };
    const initial = await call(owner, '/workspaces'); assert.equal(initial.status, 200);
    const workspaceId = initial.body.items.find((item: any) => item.ownerAccountId === owner).id;
    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${admin}`, 'PUT', { role: 'admin' })).status, 200);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${member}`, 'PUT', { role: 'member' })).status, 200);
    assert.equal((await call(admin, `/workspaces/${workspaceId}/members`)).status, 200);
    assert.equal((await call(member, `/workspaces/${workspaceId}/members`)).status, 404);
    assert.equal((await call(outsider, `/workspaces/${workspaceId}/members`)).status, 404);
    assert.equal((await call(admin, `/workspaces/${workspaceId}/members/${owner}`, 'PUT', { role: 'member' })).status, 404);
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', model: 'default', instructions: '', workingDirectory: '', permissionMode: 'read_only', allowDelegation: false } } });
    const foreignAgent = await db.aiAgent.create({ data: { accountId: outsider, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const listPath = `/workspaces/${workspaceId}/resources?kind=agent`;
    assert.equal((await call(member, listPath)).body.items.length, 0);
    const grant = { memberAccountId: member, resourceKind: 'agent', resourceId: agent.id, canView: true, canRun: false, canApprove: false };
    assert.equal((await call(member, `/workspaces/${workspaceId}/grants`, 'PUT', grant)).status, 404);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/grants`, 'PUT', { ...grant, resourceId: foreignAgent.id })).status, 404);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/grants`, 'PUT', grant)).status, 200);
    assert.deepEqual((await call(member, listPath)).body.items.map((item: any) => item.id), [agent.id]);
    assert.equal((await call(outsider, listPath)).status, 404);
    const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex', prompt: 'Fixture', status: 'running' } } }, include: { tasks: true } });
    const machineId = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    const capPath = `/executions/${execution.id}/capabilities`;
    assert.equal((await call(outsider, capPath, 'POST', { allowedOps: ['event'], expiresInSeconds: 60 })).status, 404);
    const issued = await call(owner, capPath, 'POST', { allowedOps: ['event'], expiresInSeconds: 60 });
    assert.equal(issued.status, 201);
    const stored = await db.aiExecutionCapability.findUniqueOrThrow({ where: { id: issued.body.id } });
    assert.equal(stored.tokenHash, createHash('sha256').update(issued.body.token).digest('hex'));
    assert.notEqual(stored.tokenHash, issued.body.token);
    const verifyBody = { token: issued.body.token, machineId, operation: 'event' };
    const verify = async (accountId: string, body = verifyBody, executionId = execution.id) =>
        (await call(accountId, `/executions/${executionId}/capabilities/verify`, 'POST', body)).body.valid;
    assert.equal(await verify(owner), true);
    assert.equal(await verify(owner, { ...verifyBody, operation: 'finish' }), false);
    assert.equal(await verify(owner, { ...verifyBody, machineId: randomUUID() }), false);
    assert.equal(await verify(owner, verifyBody, randomUUID()), false);
    assert.equal(await verify(member), false); assert.equal(await verify(outsider), false);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${member}`, 'DELETE')).status, 204);
    assert.equal(await verify(owner), false, 'Authorization revision did not revoke the old capability');
    assert.equal((await call(member, listPath)).status, 404);
    const fresh = await call(owner, capPath, 'POST', { allowedOps: ['event'], expiresInSeconds: 60 });
    assert.equal(fresh.status, 201);
    await db.aiExecutionCapability.update({ where: { id: fresh.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await verify(owner, { ...verifyBody, token: fresh.body.token }), false);
    console.log('REAL_DB_HTTP_WORKSPACE_ROLES_RESOURCE_GRANTS_AND_CAPABILITY_SCOPE_REVOCATION_EXPIRY_OK');

    assert.equal((await call(owner, `/workspaces/${workspaceId}/members/${member}`, 'PUT', { role: 'member' })).status, 200);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/grants`, 'PUT', { ...grant, canView: false, canRun: true })).status, 400);
    assert.equal((await call(owner, `/workspaces/${workspaceId}/grants`, 'PUT', grant)).status, 200);
    const conversation = await db.aiConversation.create({ data: { accountId: owner, agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned event visibility fixture', sourceType: 'execution',
        sourceLabel: 'Owned fixture', sourceResourceId: tag, assigneeId: agent.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
    const eventCap = await call(owner, capPath, 'POST', { allowedOps: ['event'], expiresInSeconds: 60 });
    assert.equal(eventCap.status, 201);
    const eventsPath = `/executions/${execution.id}/events`;
    const event = { eventId: `${tag}-one`, seq: 1, kind: 'tool', phase: 'completed', occurredAt: new Date().toISOString(),
        machineId, capability: eventCap.body.token,
        summary: 'Bearer fixture-bearer-token OPENAI_API_KEY=fixture-api-key /home/fixture/private/file DATABASE_URL=postgresql://fixture-user:fixture-password@localhost/fixture https://example.invalid/file?X-Amz-Signature=fixture-signature https://example.invalid/file?%74oken=fixture-encoded-token' };
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => call(owner, eventsPath, 'POST', event)));
    assert.ok(concurrent.every((response) => [200, 201, 409].includes(response.status)));
    assert.ok(concurrent.some((response) => response.status === 201));
    assert.equal((await call(owner, eventsPath, 'POST', event)).status, 200);
    assert.equal(await db.aiPersistentExecutionEvent.count({ where: { executionId: execution.id } }), 1);
    assert.equal((await call(owner, eventsPath, 'POST', { ...event, summary: 'Changed content' })).status, 409);
    assert.equal((await call(owner, eventsPath, 'POST', { ...event, eventId: `${tag}-wrong-machine`, machineId: randomUUID() })).status, 409);
    assert.equal((await call(owner, eventsPath, 'POST', { ...event, eventId: `${tag}-old-seq` })).status, 409);
    assert.equal((await call(outsider, eventsPath, 'POST', event)).status, 409);
    assert.equal((await call(outsider, eventsPath)).status, 404);
    assert.equal((await call(member, eventsPath)).status, 200, 'Member view grant did not authorize actual event replay');
    assert.equal((await call(admin, eventsPath)).status, 200);
    assert.equal((await call(owner, eventsPath, 'POST', { ...event, eventId: `${tag}-two`, seq: 2, summary: 'Second owned event' })).status, 201);
    const page = await call(owner, `${eventsPath}?limit=1`);
    assert.equal(page.status, 200); assert.equal(page.body.items.length, 1); assert.equal(page.body.nextAfterSeq, 1);
    const redactedSummary = page.body.items[0].redactedSummary;
    assert.doesNotMatch(redactedSummary, /fixture-bearer-token|fixture-api-key|\/home\/fixture/);
    const next = await call(owner, `${eventsPath}?limit=1&afterSeq=${page.body.nextAfterSeq}`);
    assert.equal(next.body.items[0].seq, 2); assert.equal(next.body.nextAfterSeq, 2);
    await db.aiPersistentExecutionEvent.updateMany({ where: { executionId: execution.id },
        data: { createdAt: new Date(Date.now() - 31 * 86400000) } });
    await redactExpiredExecutionEvents(new Date(), owner);
    const retained = await call(owner, eventsPath);
    assert.equal(retained.body.items.length, 2);
    assert.ok(retained.body.items.every((item: any) => item.redactedSummary === '' && item.redactedAt));
    assert.equal((await call(owner, eventsPath, 'POST', event)).status, 200, 'Retention broke event replay identity');
    console.log('REAL_DB_HTTP_EXECUTION_EVENTS_CONCURRENCY_REPLAY_CONFLICT_PAGINATION_AND_RETENTION_OK');
    assert.equal((await call(owner, `/workspaces/${workspaceId}/grants`, 'PUT', { ...grant, canView: false })).status, 200);
    assert.equal((await call(member, eventsPath)).status, 404, 'Revoked view grant still exposed execution events');
    assert.equal((await call(owner, eventsPath, 'POST', { ...event, eventId: tag+'-revoked', seq: 3 })).status, 409);
    console.log('REAL_DB_HTTP_MEMBER_EVENT_VIEW_GRANT_AND_IMMEDIATE_REVOCATION_OK');
    assert.doesNotMatch(redactedSummary, /fixture-password/,
        'Execution event replay leaked a database URL password');
    assert.doesNotMatch(redactedSummary, /fixture-signature|fixture-encoded-token/,
        'Execution event replay leaked a signed URL or encoded query token');
    console.log('REAL_DB_HTTP_EXECUTION_EVENT_URL_CREDENTIAL_REDACTION_OK');
} finally {
    await app.close();
    await db.aiPersistentExecutionEvent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiWorkspace.deleteMany({ where: { ownerAccountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `workspace-auth-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect(); redis.disconnect();
}
