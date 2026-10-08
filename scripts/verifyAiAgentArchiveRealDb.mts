import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';

// Actual PostgreSQL and archive HTTP. Account auth/runtime records are owned
// fixtures; no daemon/provider. Active work must be explicitly blocked or
// durably cancelled when archiving, matching the production handoff scope.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `archive-${randomUUID()}`; const accounts: string[] = []; const runs: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) return reply.code(401).send({ error: 'fixture' });
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    aiTeamRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const makeAgent = (suffix: string) => db.aiAgent.create({ data: { accountId: accounts[0],
        name: `${tag}-${suffix}`, role: 'fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', permissionMode: 'read_only' } } });
    const archive = (id: string, account = accounts[0]) => fetch(`${base}/v1/ai-team/agents/${id}`, {
        method: 'DELETE', signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': account },
    });
    const idle = await makeAgent('idle');
    assert.equal((await archive(idle.id, accounts[1])).status, 404);
    assert.equal((await archive(idle.id)).status, 204);
    const idleAfter = await db.aiAgent.findUniqueOrThrow({ where: { id: idle.id } });
    assert.ok(idleAfter.archivedAt); assert.equal(idleAfter.enabled, false);
    assert.equal((await archive(idle.id)).status, 404);
    const listArchived = (account = accounts[0], query = '') => fetch(`${base}/v1/ai-team/agents/archived${query}`, {
        signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': account },
    });
    const anotherIdle = await makeAgent('another-idle');
    assert.equal((await archive(anotherIdle.id)).status, 204);
    const firstPageResponse = await listArchived(accounts[0], '?limit=1');
    assert.equal(firstPageResponse.status, 200); const firstPage = await firstPageResponse.json() as any;
    assert.equal(firstPage.items.length, 1); assert.ok(firstPage.nextCursor);
    const secondPage = await (await listArchived(accounts[0], `?limit=1&cursor=${firstPage.nextCursor}`)).json() as any;
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
    assert.deepEqual(new Set([...firstPage.items, ...secondPage.items].map((row: any) => row.id)), new Set([idle.id, anotherIdle.id]));
    for (const row of [...firstPage.items, ...secondPage.items]) {
        assert.deepEqual(Object.keys(row).sort(), ['archivedAt', 'enabled', 'id', 'name', 'role']);
        assert.equal(row.enabled, false); assert.ok(row.archivedAt);
    }
    assert.deepEqual((await (await listArchived(accounts[1])).json() as any).items, []);
    assert.equal((await listArchived(accounts[0], '?cursor=unknown')).status, 400);
    const foreignArchived = await db.aiAgent.create({ data: { accountId: accounts[1], name: tag,
        role: 'fixture', description: '', emoji: '', instructions: 'private fixture',
        settings: { workingDirectory: '/private/owned-archive-fixture' }, archivedAt: new Date(), enabled: false } });
    assert.equal((await listArchived(accounts[0], `?cursor=${foreignArchived.id}`)).status, 400);
    const enable = () => fetch(`${base}/v1/ai-team/agents/${idle.id}`, {
        method: 'PUT', signal: AbortSignal.timeout(15000),
        headers: { 'x-fixture-account': accounts[0], 'content-type': 'application/json' },
        body: JSON.stringify({ name: idle.name, role: 'fixture', description: 'Owned lifecycle fixture',
            emoji: '', skills: [], responsibilities: [], enabled: true,
            settings: { instructions: '', engine: 'codex', model: 'default',
                workingDirectory: '/tmp', permissionMode: 'read_only', allowDelegation: false } }),
    });
    assert.ok([404, 409].includes((await enable()).status), 'A stale editor re-enabled an archived Agent');
    assert.equal((await db.aiAgent.findUniqueOrThrow({ where: { id: idle.id } })).enabled, false);
    const restore = (account = accounts[0]) => fetch(`${base}/v1/ai-team/agents/${idle.id}/restore`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: {
            'x-fixture-account': account, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal((await restore(accounts[1])).status, 404);
    assert.equal((await restore()).status, 200);
    const restored = await db.aiAgent.findUniqueOrThrow({ where: { id: idle.id } });
    assert.equal(restored.archivedAt, null); assert.equal(restored.enabled, false);
    const afterRestoreList = await (await listArchived()).json() as any;
    assert.deepEqual(afterRestoreList.items.map((row: any) => row.id), [anotherIdle.id]);
    console.log('REAL_DB_HTTP_ARCHIVED_AGENT_DISCOVERY_OWNER_ONLY_PAGINATION_SAFE_SUMMARY_AND_RESTORE_REMOVAL_OK');
    const duplicateRestore = await restore(); assert.equal(duplicateRestore.status, 200);
    assert.equal((await duplicateRestore.json() as any).duplicate, true);
    assert.equal((await enable()).status, 200);
    assert.equal((await db.aiAgent.findUniqueOrThrow({ where: { id: idle.id } })).enabled, true);
    console.log('REAL_DB_HTTP_AGENT_RESTORE_OWNER_ONLY_DISABLED_IDEMPOTENT_AND_STALE_ENABLE_FENCE_OK');
    const outcomes: Array<{ status: string; httpStatus: number; runStatus: string; taskStatus: string; archived: boolean }> = [];
    for (const status of ['queued', 'running', 'canceling']) {
        const agent = await makeAgent(status);
        const conversation = await db.aiConversation.create({ data: { accountId: accounts[0],
            scopeKey: `${tag}-${status}`, kind: 'direct', agentId: agent.id, title: tag } });
        const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag, status,
            tasks: { create: { seq: 1, taskKey: status, provider: 'codex', prompt: '', status } } },
            include: { tasks: true } }); runs.push(run.id);
        if (status === 'running') await db.orchestratorExecution.create({ data: { runId: run.id,
            taskId: run.tasks[0].id, provider: 'codex', machineId: `${tag}-machine`, status: 'running',
            dispatchToken: randomUUID() } });
        await db.aiWorkItem.create({ data: { accountId: accounts[0], title: tag, summary: 'Owned lifecycle fixture',
            sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id, assigneeId: agent.id,
            conversationId: conversation.id, orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
        const response = await archive(agent.id);
        const after = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id }, include: { tasks: true } });
        const agentAfter = await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id } });
        outcomes.push({ status, httpStatus: response.status, runStatus: after.status,
            taskStatus: after.tasks[0].status, archived: !!agentAfter.archivedAt });
    }
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_AGENT_ARCHIVE_ACTIVE_WORK_POLICY', outcomes }));
    for (const outcome of outcomes) {
        assert.ok(outcome.httpStatus === 409 && !outcome.archived
            || outcome.httpStatus === 204 && outcome.archived
                && ['canceling', 'cancelled'].includes(outcome.runStatus),
        `Archiving ${outcome.status} work neither blocked nor durably requested cancellation`);
    }
    console.log('REAL_DB_HTTP_AGENT_ARCHIVE_IDLE_TENANT_AND_ACTIVE_WORK_HANDLED_OK');
} finally {
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_AGENT_ARCHIVE_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
