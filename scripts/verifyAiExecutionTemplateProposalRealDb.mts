import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { provisionDispatchCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';
import { AiExecutionCapabilitySchema, AiExecutionTemplateContextSchema,
    AiAgentTemplateProposalSchema } from 'happy-wire';

// Real HTTP/PostgreSQL and production dispatch provisioner. Auth, initial
// Agent/task and running runner identity are owned fixtures, not a daemon.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `execution-template-root-${randomUUID()}`;
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && args[0] === '--dispatching-context');
const dispatchingContext = args.includes('--dispatching-context');
const local = mkdtempSync(join(tmpdir(), 'happy-template-context-root-'));
const accounts: string[] = []; const runs: string[] = []; const executions: string[] = [];
app.decorate('authenticate', async (request: any, reply: any) => {
    const actor = request.headers['x-fixture-account'] ?? request.headers.authorization?.replace(/^Bearer /, '');
    if (!accounts.includes(actor)) return reply.code(401).send({ error: 'fixture' });
    request.userId = actor;
});
app.addHook('onResponse', async (request: any, reply: any) => {
    if (request.headers.authorization && request.url.endsWith('/template-proposals')) {
        console.log(`REAL_CLI_TEMPLATE_PROPOSAL_HTTP status=${reply.statusCode} bodyKeys=${Object.keys(request.body ?? {}).sort().join(',')}`);
    }
});
try {
    for (const index of [0, 1]) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${index}` } })).id);
    const [owner, outsider] = accounts;
    aiTeamRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const call = (actor: string, path: string, method = 'POST', body?: unknown) => fetch(`${base}/v1/ai-team${path}`, {
        method, signal: AbortSignal.timeout(15000), headers: { 'x-fixture-account': actor,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const content = { role: 'Reviewer', description: 'Owned fixture', emoji: '', skills: ['Review'],
        responsibilities: ['Check changes'], instructions: 'Owned original template instructions' };
    const created = await call(owner, '/agent-templates', 'POST', { name: tag, content });
    assert.equal(created.status, 201); const template = await created.json() as any;
    assert.equal((await call(owner, `/agent-templates/${template.id}/versions/1/publish`, 'POST', { confirmed: true })).status, 200);
    const version = await db.aiAgentTemplateVersion.findUniqueOrThrow({ where: {
        templateId_version: { templateId: template.id, version: 1 } } });
    const settings = { engine: 'codex', model: 'fixture', workingDirectory: `/owned/${tag}`,
        permissionMode: 'read_only', allowDelegation: false, instructions: content.instructions };
    const agent = await db.aiAgent.create({ data: { accountId: owner, name: tag, role: content.role,
        description: content.description, emoji: '', instructions: content.instructions,
        settings, enabled: true, templateVersionId: version.id } });
    const conversation = await db.aiConversation.create({ data: { accountId: owner,
        agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const createExecution = async (bound: boolean) => {
        const run = await db.orchestratorRun.create({ data: { accountId: owner, title: tag, status: 'running',
            tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex', prompt: '', status: 'dispatching',
                permissionMode: 'read_only', assignedAgentId: agent.id, targetMachineId: tag,
                workingDirectory: settings.workingDirectory } } }, include: { tasks: true } }); runs.push(run.id);
        await db.aiWorkItem.create({ data: { accountId: owner, title: tag, summary: 'Owned fixture',
            sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id,
            assigneeId: agent.id, conversationId: conversation.id,
            orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
        if (!bound) await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: null } });
        const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: run.tasks[0].id,
            machineId: tag, provider: 'codex', status: 'dispatching', dispatchToken: randomUUID() } }); executions.push(execution.id);
        const capability = await provisionDispatchCapability({ accountId: owner, executionId: execution.id,
            machineId: tag, dispatchToken: execution.dispatchToken, timeoutMs: 300000 });
        AiExecutionCapabilitySchema.parse(capability);
        if (dispatchingContext && bound) {
            const contextPath = `/executions/${execution.id}/template-proposals/context`;
            const proof = { machineId: tag, dispatchToken: execution.dispatchToken,
                capability: capability.token };
            const response = await call(owner, contextPath, 'POST', proof);
            assert.equal(response.status, 200, 'Same-scope read-only dispatching context must precede process start');
            AiExecutionTemplateContextSchema.parse(await response.json());
            for (const [actor, changed] of [
                [outsider, proof], [owner, { ...proof, machineId: randomUUID() }],
                [owner, { ...proof, dispatchToken: randomUUID() }],
                [owner, { ...proof, capability: 'a'.repeat(64) }],
            ] as const) assert.equal((await call(actor, contextPath, 'POST', changed)).status, 409);
            assert.equal((await call(owner, `/executions/${execution.id}/template-proposals`, 'POST', {
                ...proof, templateId: template.id, expectedCurrentVersion: 1,
                clientRequestId: 'before-process-start', content, note: 'Must not propose before running',
            })).status, 409);
            assert.equal(await db.aiAgentTemplateProposal.count({ where: { sourceExecutionId: execution.id } }), 0);
            const beforeStart = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
            assert.equal(beforeStart.status, 'dispatching');
            assert.equal(beforeStart.pid, null);
            console.log('REAL_DB_HTTP_DISPATCHING_TEMPLATE_CONTEXT_READONLY_NO_PROPOSE_OR_START_OK');
        }
        await db.orchestratorExecution.update({ where: { id: execution.id }, data: { status: 'running' } });
        await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'running' } });
        if (!bound) await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: version.id } });
        return { execution, capability };
    };
    const bound = await createExecution(true);
    assert.ok(bound.capability.allowedOps.includes('template_propose'));
    assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: bound.execution.id } })).templateVersionId, version.id);
    const path = `/executions/${bound.execution.id}/template-proposals`;
    const contextPath = `${path}/context`;
    const contextInput = { machineId: tag, dispatchToken: bound.execution.dispatchToken, capability: bound.capability.token };
    const initialContextResponse = await call(owner, contextPath, 'POST', contextInput);
    assert.equal(initialContextResponse.status, 200);
    const initialContext = await initialContextResponse.json() as any;
    AiExecutionTemplateContextSchema.parse(initialContext);
    assert.equal(initialContext.templateId, template.id);
    assert.equal(initialContext.sourceExecutionId, bound.execution.id);
    assert.equal(initialContext.sourceAgentId, agent.id);
    assert.equal(initialContext.frozenVersion, 1); assert.equal(initialContext.currentVersion, 1);
    assert.deepEqual(initialContext.frozenContent, content); assert.deepEqual(initialContext.currentContent, content);
    assert.equal(initialContext.frozenContentHash, createHash('sha256').update(JSON.stringify(content)).digest('hex'));
    assert.equal(initialContext.currentContentHash, initialContext.frozenContentHash);
    assert.ok(![settings.workingDirectory, bound.capability.token, bound.execution.dispatchToken].some(value =>
        JSON.stringify(initialContext).includes(value)), 'Context disclosed private runtime identity');
    const proposalContent = { ...content, instructions: 'Owned execution proposal; requires human review' };
    const input = { machineId: tag, dispatchToken: bound.execution.dispatchToken, capability: bound.capability.token,
        templateId: template.id, expectedCurrentVersion: 1, clientRequestId: 'owned-execution-proposal',
        content: proposalContent, note: 'Owned observed improvement' };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => call(owner, path, 'POST', input)));
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 200, 200, 201]);
    const values = await Promise.all(concurrent.map(response => response.json() as Promise<any>));
    assert.equal(new Set(values.map(value => value.id)).size, 1);
    const proposal = await db.aiAgentTemplateProposal.findUniqueOrThrow({ where: { id: values[0].id } });
    assert.equal(proposal.sourceAgentId, agent.id); assert.equal(proposal.sourceExecutionId, bound.execution.id);
    assert.equal(proposal.status, 'pending'); assert.equal(proposal.reviewedAt, null);
    assert.equal(proposal.contentHash, createHash('sha256').update(JSON.stringify(proposalContent)).digest('hex'));
    assert.equal((await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: template.id } })).currentVersion, 1);
    assert.equal(await db.aiAgentTemplateVersion.count({ where: { templateId: template.id } }), 1);
    const newerContent = { ...content, instructions: 'New current published instructions' };
    const draft = await call(owner, `/agent-templates/${template.id}/versions`, 'POST', { content: newerContent });
    assert.equal(draft.status, 201); assert.equal((await draft.json() as any).version, 2);
    assert.equal((await call(owner, `/agent-templates/${template.id}/versions/2/publish`, 'POST', { confirmed: true })).status, 200);
    const currentContextResponse = await call(owner, contextPath, 'POST', contextInput);
    assert.equal(currentContextResponse.status, 200);
    const currentContext = await currentContextResponse.json() as any;
    assert.equal(currentContext.frozenVersion, 1); assert.deepEqual(currentContext.frozenContent, content);
    assert.equal(currentContext.frozenContentHash, initialContext.frozenContentHash);
    assert.equal(currentContext.currentVersion, 2); assert.deepEqual(currentContext.currentContent, newerContent);
    assert.equal(currentContext.currentContentHash, createHash('sha256').update(JSON.stringify(newerContent)).digest('hex'));
    assert.equal(await db.aiAgentTemplateProposal.count({ where: { templateId: template.id } }), 1,
        'Readonly context created a proposal');
    assert.equal((await call(owner, path, 'POST', input)).status, 200, 'Published version change broke original request replay');
    assert.equal((await call(owner, path, 'POST', { ...input, clientRequestId: 'stale-current' })).status, 409);
    assert.equal((await call(owner, path, 'POST', { ...input, clientRequestId: 'new-current',
        expectedCurrentVersion: currentContext.currentVersion })).status, 201);
    // Freeze a new dispatch at v2, then use the real rollback route to v1.
    const version2 = await db.aiAgentTemplateVersion.findUniqueOrThrow({ where: {
        templateId_version: { templateId: template.id, version: 2 } } });
    await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: version2.id } });
    const rollbackBound = await createExecution(true);
    assert.equal((await call(owner, `/agent-templates/${template.id}/rollback`, 'POST',
        { version: 1, confirmed: true })).status, 200);
    const rollbackResponse = await call(owner, `/executions/${rollbackBound.execution.id}/template-proposals/context`, 'POST', {
        machineId: tag, dispatchToken: rollbackBound.execution.dispatchToken, capability: rollbackBound.capability.token });
    assert.equal(rollbackResponse.status, 200);
    const rollbackContext = await rollbackResponse.json() as any;
    AiExecutionTemplateContextSchema.parse(rollbackContext);
    assert.equal(rollbackContext.frozenVersion, 2); assert.equal(rollbackContext.currentVersion, 1);
    assert.deepEqual(rollbackContext.frozenContent, newerContent);
    console.log('REAL_DB_HTTP_TEMPLATE_CONTEXT_FROZEN2_ROLLBACK_CURRENT1_OK');
    const inputPath = join(local, 'client-input.json');
    writeFileSync(inputPath, JSON.stringify({ accountId: owner, machineId: tag,
        executionId: rollbackBound.execution.id, dispatchToken: rollbackBound.execution.dispatchToken,
        capability: rollbackBound.capability, capabilityRoot: join(local, 'capabilities'), proxyRoot: join(local, 'p'),
        templateId: template.id, frozenContent: newerContent }), { mode: 0o600 });
    const root = fileURLToPath(new URL('../', import.meta.url));
    const client = await promisify(execFile)(join(root, 'node_modules/.bin/tsx'), [
        '--tsconfig', join(root, 'packages/happy-cli/tsconfig.json'),
        join(root, 'scripts/verifyAiTemplateContextApiClientReal.mts'), inputPath,
    ], { env: { ...process.env, HAPPY_SERVER_URL: base, HAPPY_HOME_DIR: join(local, 'client-home') },
        timeout: 30000, maxBuffer: 64000 });
    assert.ok(client.stdout.includes('REAL_CLI_API_TEMPLATE_CONTEXT_FROZEN2_ROLLBACK_CURRENT1_OK'));
    console.log('REAL_CLI_API_TEMPLATE_CONTEXT_FROZEN2_ROLLBACK_CURRENT1_OK');
    assert.ok(client.stdout.includes('REAL_CLI_UNIX_PROXY_HTTP_TEMPLATE_PENDING_CONCURRENCY_NO_IDENTITY_OVERRIDE_OR_SECRET_OK'));
    console.log('REAL_CLI_UNIX_PROXY_HTTP_TEMPLATE_PENDING_CONCURRENCY_NO_IDENTITY_OVERRIDE_OR_SECRET_OK');
    assert.equal(await db.aiAgentTemplateProposal.count({ where: { sourceExecutionId: rollbackBound.execution.id } }), 1);
    const bridgeProposal = await db.aiAgentTemplateProposal.findFirstOrThrow({ where: {
        sourceExecutionId: rollbackBound.execution.id } });
    assert.equal(bridgeProposal.sourceAgentId, agent.id); assert.equal(bridgeProposal.status, 'pending');
    assert.equal(bridgeProposal.expectedCurrentVersion, 1); assert.equal(bridgeProposal.reviewedAt, null);
    const humanDetailPath = `/agent-templates/${template.id}/proposals/${bridgeProposal.id}`;
    const humanDetailResponse = await call(owner, humanDetailPath, 'GET');
    assert.equal(humanDetailResponse.status, 200);
    const humanDetail = await humanDetailResponse.json() as any;
    AiAgentTemplateProposalSchema.parse(humanDetail);
    assert.equal(humanDetail.frozenVersion, 2);
    assert.equal(humanDetail.frozenContentHash, createHash('sha256').update(JSON.stringify(newerContent)).digest('hex'));
    assert.deepEqual(humanDetail.frozenContent, newerContent);
    assert.equal(humanDetail.expectedCurrentVersion, 1);
    assert.equal((await call(outsider, humanDetailPath, 'GET')).status, 404);
    assert.ok(![rollbackBound.capability.token, rollbackBound.execution.dispatchToken, settings.workingDirectory]
        .some(secret => JSON.stringify(humanDetail).includes(secret)));
    assert.equal((await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: template.id } })).currentVersion, 1);
    assert.equal(await db.aiAgentTemplateVersion.count({ where: { templateId: template.id } }), 2);
    await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: version.id } });
    assert.equal((await call(owner, `/agent-templates/${template.id}/rollback`, 'POST', { version: 2, confirmed: true })).status, 200);
    for (const [actor, changed] of [
        [outsider, input], [owner, { ...input, machineId: randomUUID() }],
        [owner, { ...input, dispatchToken: randomUUID() }], [owner, { ...input, capability: 'a'.repeat(64) }],
        [owner, { ...input, templateId: randomUUID() }],
    ] as const) assert.equal((await call(actor, path, 'POST', changed)).status, 409);
    assert.equal((await call(owner, path, 'POST', { ...input, sourceAgentId: randomUUID() })).status, 400);
    for (const [actor, changed] of [
        [outsider, contextInput], [owner, { ...contextInput, machineId: randomUUID() }],
        [owner, { ...contextInput, dispatchToken: randomUUID() }], [owner, { ...contextInput, capability: 'a'.repeat(64) }],
    ] as const) assert.equal((await call(actor, contextPath, 'POST', changed)).status, 409);
    assert.equal((await call(owner, contextPath, 'POST', { ...contextInput, templateId: template.id })).status, 400);
    assert.equal((await call(owner, path, 'POST', { ...input, confirmed: true })).status, 400);
    assert.equal((await call(owner, path, 'POST', { ...input, note: 'Changed note' })).status, 409);
    assert.equal((await call(owner, `/executions/${bound.execution.id}/capabilities`, 'POST', {
        allowedOps: ['template_propose'], expiresInSeconds: 300 })).status, 400);
    const unbound = await createExecution(false);
    assert.ok(!unbound.capability.allowedOps.includes('template_propose'));
    assert.equal((await call(owner, `/executions/${unbound.execution.id}/template-proposals`, 'POST', {
        ...input, dispatchToken: unbound.execution.dispatchToken, capability: unbound.capability.token })).status, 409);
    assert.equal((await call(owner, `/executions/${unbound.execution.id}/template-proposals/context`, 'POST', {
        machineId: tag, dispatchToken: unbound.execution.dispatchToken, capability: unbound.capability.token })).status, 409);
    await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: null } });
    assert.equal((await call(owner, path, 'POST', { ...input, clientRequestId: 'binding-changed' })).status, 409);
    assert.equal((await call(owner, contextPath, 'POST', contextInput)).status, 409);
    await db.aiAgent.update({ where: { id: agent.id }, data: { templateVersionId: version.id } });
    await db.orchestratorExecution.create({ data: { runId: bound.execution.runId,
        taskId: bound.execution.taskId, machineId: tag, provider: 'codex', status: 'running',
        attempt: 2, dispatchToken: randomUUID() } });
    assert.equal((await call(owner, path, 'POST', { ...input, clientRequestId: 'old-attempt' })).status, 409);
    assert.equal((await call(owner, contextPath, 'POST', contextInput)).status, 409);
    assert.equal(await db.aiAgentTemplateProposal.count({ where: { templateId: template.id } }), 3);
    assert.deepEqual((await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id } })).settings, settings);
    console.log('REAL_DB_HTTP_DISPATCH_FROZEN_TEMPLATE_CAPABILITY_PROPOSAL_NO_AUTOPUBLISH_CONCURRENCY_SCOPE_BINDING_AND_ATTEMPT_OK');
    console.log('REAL_DB_HTTP_EXECUTION_TEMPLATE_CONTEXT_FROZEN_CURRENT_HASH_NO_PRIVATE_FIELDS_READONLY_AND_STALE_VERSION_OK');
} finally {
    await app.close();
    await db.aiExecutionCapability.deleteMany({ where: { executionId: { in: executions }, accountId: accounts[0] } });
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    assert.equal(await db.aiAgentTemplateProposal.count({ where: { sourceExecutionId: { in: executions } } }), 0);
    console.log('AI_EXECUTION_TEMPLATE_ROOT_FIXTURE_CLEANUP residual=0');
    rmSync(local, { recursive: true, force: true });
    await db.$disconnect(); redis.disconnect();
}
