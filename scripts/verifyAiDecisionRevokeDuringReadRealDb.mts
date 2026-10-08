import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { issueExecutionCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';

// Real HTTP revoke commits after the actual Decision rows are read. Auth,
// initial account/resources and runner identity are owned fixtures.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `decision-read-revoke-root-${randomUUID()}`; const accounts: string[] = []; const runs: string[] = [];
const originalFindMany = db.aiDecisionRequest.findMany.bind(db.aiDecisionRequest);
let release = () => {}; let intercepted = false; let armed = false;
app.decorate('authenticate', async (request: any, reply: any) => {
    const actor = request.headers['x-fixture-account'];
    if (!accounts.includes(actor)) return reply.code(401).send({ error: 'owned_fixture' });
    request.userId = actor;
});
try {
    for (const index of [0, 1]) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${index}` } })).id);
    const [owner, member] = accounts;
    aiTeamRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = (actor: string, path: string, method = 'GET', body?: unknown) => fetch(`${base}/v1/ai-team${path}`, {
        method, signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': actor,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: '',
        description: '', emoji: '', instructions: '', settings: {}, enabled: true } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner, agentId: agent.id,
        kind: 'direct', scopeKey: tag, title: tag } });
    const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'approval', provider: 'codex', prompt: '', status: 'running',
            permissionMode: 'approval', assignedAgentId: agent.id } } }, include: { tasks: true } }); runs.push(run.id);
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
        machineId: tag, provider: 'codex', status: 'running', dispatchToken: randomUUID(),
        childSessionId: randomUUID(), worktreePath: `/owned-fixture/${tag}`, branchName: 'owned-approval' } });
    await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned fixture',
        sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id,
        assigneeId: agent.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
    const capability = await issueExecutionCapability({ accountId: owner, executionId: execution.id,
        allowedOps: ['decision_request'], expiresAt: new Date(Date.now() + 60000) });
    const workspace = await db.aiWorkspace.findUniqueOrThrow({ where: { ownerAccountId: owner } });
    await db.aiWorkspaceMembership.create({ data: { workspaceId: workspace.id, memberAccountId: member, role: 'member' } });
    await db.aiWorkspaceGrant.create({ data: { workspaceId: workspace.id, memberAccountId: member,
        resourceKind: 'agent', resourceId: agent.id, canView: true, canApprove: true, canRun: false } });
    const created = await call(owner, `/executions/${execution.id}/decisions`, 'POST', {
        machineId: tag, capability: capability.token, kind: 'approval', summary: 'Owned bounded approval',
        operationId: tag, actionType: 'shell', actionHash: createHash('sha256').update(tag).digest('hex'),
        expiresAt: new Date(Date.now() + 60000).toISOString() });
    assert.equal(created.status, 201); const decisionId = (await created.json() as any).id;
    const before = await call(member, '/decisions?status=pending'); assert.equal(before.status, 200);
    assert.equal((await before.json() as any).items.filter((item: any) => item.id === decisionId).length, 1);
    let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    (db.aiDecisionRequest as any).findMany = async (query: any) => {
        const rows = await originalFindMany(query);
        if (armed && rows.some(row => row.id === decisionId)) {
            armed = false; intercepted = true; entered(); await released;
        }
        return rows;
    };
    armed = true; const inFlight = call(member, '/decisions?status=pending');
    await Promise.race([enteredPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('Owned Decision read barrier not reached')), 5000))]);
    assert.equal((await call(owner, `/workspaces/${workspace.id}/members/${member}`, 'DELETE')).status, 204);
    assert.equal(await db.aiWorkspaceMembership.count({ where: { workspaceId: workspace.id, memberAccountId: member } }), 0);
    release(); const after = await inFlight; assert.equal(after.status, 200);
    const visible = (await after.json() as any).items.filter((item: any) => item.id === decisionId).length;
    console.log(`REAL_HTTP_DECISION_READ_THEN_REVOKE intercepted=${intercepted} revokedMemberVisibleRows=${visible}`);
    assert.equal(visible, 0, 'Decision read returned rows after membership revocation committed');
    assert.equal((await (await call(member, '/decisions?status=pending')).json() as any).items.length, 0);
    assert.equal(await db.aiDecisionRequest.count({ where: { id: decisionId } }), 1, 'Revoke erased approval audit');
    console.log('REAL_DB_HTTP_DECISION_ROWS_READ_MEMBERSHIP_REVOKE_COMMIT_RESPONSE_FILTER_OK');
} finally {
    release(); (db.aiDecisionRequest as any).findMany = originalFindMany;
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    console.log('AI_DECISION_READ_REVOKE_ROOT_FIXTURE_CLEANUP residual=0');
    await db.$disconnect(); redis.disconnect();
}
