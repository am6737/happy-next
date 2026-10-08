import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../sources/storage/db';
import { redis } from '../sources/storage/redis';
import { ensureOwnerWorkspace } from '../sources/app/ai/workspaceAuth';
import { aiTeamRoutes } from '../sources/app/api/routes/aiTeamRoutes';

const require = createRequire(import.meta.url);
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID();
const accounts: string[] = [];
let projectId: string | undefined;
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accounts.includes(request.headers['x-fixture-account'])) {
        return reply.code(401).send({ error: 'fixture' });
    }
    request.userId = request.headers['x-fixture-account'];
});
try {
    for (let i = 0; i < 3; i++) accounts.push((await db.account.create({ data: {
        publicKey: `member-controls-${tag}-${i}` } })).id);
    const [owner, member, outsider] = accounts;
    const workspace = await ensureOwnerWorkspace(owner);
    await db.aiWorkspaceMembership.create({ data: { workspaceId: workspace.id,
        memberAccountId: member, role: 'member' } });
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag,
        role: 'fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const project = await db.aiProject.create({ data: { accountId: owner,
        name: tag, clientRequestId: tag } });
    projectId = project.id;
    await db.aiProjectVersion.create({ data: { projectId: project.id, version: 1,
        kind: 'github', repositoryId: 123n, repositoryFullName: 'fixture/owned',
        machineId: tag, registeredRepoId: tag, registeredKvVersion: 1,
        workingDirectory: `/tmp/${tag}`, defaultBranch: 'main', baseCommit: 'a'.repeat(40),
        snapshotHash: 'b'.repeat(64) } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner,
        scopeKey: tag, kind: 'direct', agentId: agent.id, title: tag } });
    await db.aiWorkspaceGrant.create({ data: { workspaceId: workspace.id,
        memberAccountId: member, resourceKind: 'agent', resourceId: agent.id,
        canView: true, canRun: true, canApprove: true } });
    const fixtures: Record<string, { workId: string; taskId: string; runId: string }> = {};
    for (const status of ['queued', 'failed', 'running', 'completed']) {
        const run = await db.orchestratorRun.create({ data: { accountId: owner,
            title: `${tag}-${status}`, status,
            tasks: { create: { seq: 1, taskKey: status, provider: 'codex',
                prompt: 'Owned fixture', status } } }, include: { tasks: true } });
        if (status !== 'queued') await db.orchestratorExecution.create({ data: {
            runId: run.id, taskId: run.tasks[0].id, machineId: tag,
            provider: 'codex', status, dispatchToken: randomUUID(),
            ...(status === 'completed' ? { childSessionId: randomUUID() } : {}),
        } });
        const work = await db.aiWorkItem.create({ data: { accountId: owner,
            title: `${tag}-${status}`, summary: 'Owned fixture', sourceType: 'execution',
            sourceLabel: 'fixture', sourceResourceId: run.id, projectId: project.id,
            projectVersion: 1,
            ...(status === 'completed' ? { deliveryVerificationStatus: 'verified',
                deliveryVerifiedAt: new Date() } : {}),
            assigneeId: agent.id, conversationId: conversation.id,
            orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
        fixtures[status] = { workId: work.id, taskId: run.tasks[0].id, runId: run.id };
    }
    aiTeamRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const spare = await db.aiAgent.create({ data: { accountId: owner,
        name: `${tag}-restore`, role: 'fixture', description: '', emoji: '',
        instructions: '', settings: {} } });
    const call = async (actor: string, path: string, body?: object) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, body ? {
            method: 'POST', headers: { 'content-type': 'application/json',
                'x-fixture-account': actor }, body: JSON.stringify(body),
        } : { headers: { 'x-fixture-account': actor } });
        return { status: response.status, body: await response.json() as any };
    };
    const archive = await fetch(`${base}/v1/ai-team/agents/${spare.id}`, {
        method: 'DELETE', headers: { 'x-fixture-account': owner } });
    assert.equal(archive.status, 204);
    assert.equal((await call(outsider, `/agents/${spare.id}/restore`, {})).status, 404);
    const restored = await call(owner, `/agents/${spare.id}/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.body.enabled, false);
    assert.equal((await call(owner, `/agents/${spare.id}/restore`, {})).body.duplicate, true);
    const cancelPath = `/work-items/${fixtures.queued.workId}/cancel`;
    assert.equal((await call(member, cancelPath, { clientRequestId: 'cancel' })).status, 404);
    assert.equal((await call(outsider, cancelPath, { clientRequestId: 'cancel' })).status, 404);
    await db.aiWorkspaceGrant.create({ data: { workspaceId: workspace.id,
        memberAccountId: member, resourceKind: 'project', resourceId: project.id,
        canView: true, canRun: true, canApprove: true } });
    assert.equal((await call(member, cancelPath, { clientRequestId: 'cancel' })).status, 200);
    assert.equal((await call(member, cancelPath, { clientRequestId: 'cancel' })).status, 200);
    assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: {
        id: fixtures.queued.runId } })).status, 'canceling');
    const retryPath = `/work-items/${fixtures.failed.workId}/retry`;
    const retry = await call(member, retryPath, { clientRequestId: 'retry' });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.executionId, (await db.orchestratorExecution.findFirstOrThrow({
        where: { taskId: fixtures.failed.taskId }, orderBy: { attempt: 'desc' } })).id);
    const steeringPath = `/work-items/${fixtures.running.workId}/steering`;
    const request = { clientRequestId: 'steer', text: 'Check the owned fixture' };
    const steering = await call(member, steeringPath, request);
    assert.equal(steering.status, 202);
    assert.equal((await call(member, steeringPath, request)).body.steeringId,
        steering.body.steeringId);
    assert.equal((await call(member, steeringPath, { ...request, text: 'Changed text' })).status, 409);
    const stored = await db.aiSteeringMessage.findUniqueOrThrow({ where: {
        id: steering.body.steeringId } });
    assert.equal(stored.accountId, owner);
    assert.equal(stored.actorAccountId, member);
    assert.equal((await call(member, `${steeringPath}/${stored.id}`)).status, 200);
    const acceptancePath = `/work-items/${fixtures.completed.workId}/acceptance`;
    const reviewed = await db.orchestratorExecution.findFirstOrThrow({ where: {
        taskId: fixtures.completed.taskId }, select: { id: true } });
    assert.equal((await call(outsider, acceptancePath, { status: 'approved',
        reviewedExecutionId: reviewed.id })).status, 404);
    assert.equal((await call(member, acceptancePath, { status: 'approved',
        reviewedExecutionId: reviewed.id, note: 'Reviewed fixture' })).status, 200);
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: {
        id: fixtures.completed.workId } })).acceptanceStatus, 'approved');
    const revision = await call(member, acceptancePath, { status: 'changes_requested',
        clientMessageId: 'revision', note: 'Revise owned fixture' });
    assert.equal(revision.status, 200);
    assert.equal((await db.orchestratorExecution.count({ where: {
        taskId: fixtures.completed.taskId } })), 2);
    const actorMessages = await db.aiMessage.findMany({ where: {
        conversationId: conversation.id, sender: 'user' }, select: { payload: true } });
    assert.ok(actorMessages.some(row => (row.payload as any).actorAccountId === member));
    assert.equal((await call(member, acceptancePath, { status: 'approved',
        reviewedExecutionId: reviewed.id })).status, 409);
    await db.aiWorkspaceGrant.update({ where: {
        workspaceId_memberAccountId_resourceKind_resourceId: {
            workspaceId: workspace.id, memberAccountId: member,
            resourceKind: 'project', resourceId: project.id,
        } }, data: { canRun: false } });
    assert.equal((await call(member, steeringPath, { clientRequestId: 'steer-after-revoke',
        text: 'Should be refused' })).status, 404);
    console.log('REAL_DB_HTTP_MEMBER_CONTROL_APPROVAL_REVISION_DOUBLE_GRANT_ACTOR_OK');
} finally {
    await app.close();
    if (accounts.length) {
        await db.orchestratorRun.deleteMany({ where: { accountId: accounts[0],
            title: { startsWith: tag } } });
        await db.aiConversation.deleteMany({ where: { accountId: accounts[0],
            scopeKey: tag } });
        if (projectId) await db.aiProject.deleteMany({ where: { id: projectId,
            accountId: accounts[0] } });
        await db.aiAgent.deleteMany({ where: { accountId: accounts[0],
            name: { startsWith: tag } } });
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accounts[0] } });
        await db.account.deleteMany({ where: { id: { in: accounts },
            publicKey: { startsWith: `member-controls-${tag}` } } });
        assert.equal(await db.account.count({ where: {
            publicKey: { startsWith: `member-controls-${tag}` } } }), 0);
    }
    await db.$disconnect();
    redis.disconnect();
}
process.exit(0);
