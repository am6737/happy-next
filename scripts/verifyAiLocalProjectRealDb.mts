import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';
import { kvRoutes } from '../packages/happy-server/sources/app/api/routes/kvRoutes';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { integrationExpectedHash } from '../packages/happy-server/sources/app/ai/integrationHash';
import { autopilotRunTick } from '../packages/happy-server/sources/app/ai/autopilot';
import { orchestratorSchedulerTick } from '../packages/happy-server/sources/app/orchestrator/scheduler';
import { loadDispatchProjectSnapshot } from '../packages/happy-server/sources/app/ai/projectSnapshot';
import { validateProjectSnapshot } from '../packages/happy-cli/src/orchestrator/projectSnapshot';
import { RpcBridgeUnavailableError } from '../packages/happy-server/sources/app/api/socket/rpcBridge';
import { AiExecutionCapabilitySchema, AiWorkspaceWorkItemSchema, AiRuntimeContractSchema } from 'happy-wire';

// Actual HTTP Project and account-scoped KV APIs, actual CLI registered-repo
// verifier in an isolated subprocess, and real local Git. RPC transport and
// authentication middleware are fixture adapters; no daemon/provider/GitHub.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const accounts: string[] = [];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 1 && ['--rpc-bridge-unavailable', '--snapshot-read-failure', '--runtime-upgrade-rejection'].includes(args[0]));
const bridgeFailure = args.includes('--rpc-bridge-unavailable');
const snapshotReadFailure = args.includes('--snapshot-read-failure');
const runtimeUpgradeRejection = args.includes('--runtime-upgrade-rejection');
let failBridge = false;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'happy-local-project-')));
const repo = join(root, 'repo'); mkdirSync(repo);
let base = '';
app.decorate('authenticate', async (request: any, reply: any) => {
    const accountId = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!accounts.includes(accountId)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = accountId;
});
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function verify(accountId: string, machineId: string, request: unknown) {
    const input = join(root, `${randomUUID()}.json`);
    writeFileSync(input, JSON.stringify({ accountId, machineId, request }), { mode: 0o600 });
    return await new Promise<any>((resolve, reject) => {
        const child = spawn('npx', ['tsx', '--tsconfig', 'packages/happy-cli/tsconfig.json', 'scripts/verifyAiRegisteredRepoClientReal.mts', input], {
            cwd: new URL('../', import.meta.url), env: { ...process.env, HAPPY_HOME_DIR: join(root, 'happy'), HAPPY_SERVER_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', (data) => { output += data; });
        child.stderr.resume();
        const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', (code) => { clearTimeout(timer); rmSync(input, { force: true });
            if (code !== 0) return reject(new Error('Isolated registered-repo client failed'));
            try { resolve(JSON.parse(output)); } catch { reject(new Error('Registered-repo client returned invalid JSON')); } });
    });
}
try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@invalid.local');
    writeFileSync(join(repo, 'README.md'), 'Owned local project fixture.\n'); git('add', '.'); git('commit', '-m', 'fixture base');
    const sha = git('rev-parse', 'HEAD');
    const commonHash = createHash('sha256').update(realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir'))).digest('hex');
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `local-project-${tag}-${i}` } })).id);
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId: accounts[0], metadata: '{}', active: true } });
    await db.userKVStore.create({ data: { accountId: accounts[0], key: `repos:${machineId}`, version: 0,
        value: Buffer.from(JSON.stringify([{ id: tag, path: repo, displayName: 'Owned local repo' }])).toString('base64') } });
    kvRoutes(app); aiTeamRoutes(app); base = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket: any = { connected: true, timeout: () => socket,
        emitWithAck: async (_event: string, input: any) => {
            if (failBridge) throw new RpcBridgeUnavailableError();
            return verify(accounts[0], machineId, input.params);
        } };
    getOrCreateUserRpcListeners(accounts[0]).set(`${machineId}:orchestrator-verify-registered-repo`, socket);
    const request = { registeredRepoId: tag, workingDirectory: repo, defaultBranch: 'main' };
    const checked = await verify(accounts[0], machineId, request);
    assert.equal(checked.verified, true); assert.equal(checked.baseCommit, sha); assert.equal(checked.commonGitDirHash, commonHash);
    assert.equal((await verify(accounts[1], machineId, request)).verified, false);
    assert.equal((await verify(accounts[0], machineId, { ...request, registeredRepoId: 'unregistered' })).verified, false);
    assert.equal((await verify(accounts[0], machineId, { ...request, workingDirectory: root })).verified, false);
    const body = { kind: 'local', name: 'Owned local Project', clientRequestId: tag, machineId, registeredKvVersion: 0, ...request };
    const create = async (input: unknown) => {
        const response = await fetch(`${base}/v1/ai-team/projects`, { method: 'POST', signal: AbortSignal.timeout(25_000),
            headers: { authorization: `Bearer ${accounts[0]}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, retryAfter: response.headers.get('retry-after'),
            body: await response.json() as any };
    };
    if (bridgeFailure) {
        failBridge = true;
        const unavailable = await create(body);
        assert.equal(unavailable.status, 503);
        assert.equal(unavailable.retryAfter, '2');
        assert.deepEqual(unavailable.body, { errorCode: 'AI_RPC_BRIDGE_UNAVAILABLE' });
        assert.equal(await db.aiProject.count({ where: { accountId: accounts[0] } }), 0);
        assert.equal(await db.orchestratorRun.count({ where: { accountId: accounts[0] } }), 0);
        failBridge = false;
        console.log('REAL_HTTP_PROJECT_BRIDGE_ERROR_503_RETRY_AFTER_NO_PROJECT_OR_RUN_OK fixtureRpc=true');
    }
    const created = await create(body); assert.equal(created.status, 201);
    const version = await db.aiProjectVersion.findUniqueOrThrow({ where: { projectId_version: { projectId: created.body.id, version: 1 } } });
    assert.equal(version.kind, 'local'); assert.equal(version.repositoryId, null); assert.equal(version.repositoryFullName, null);
    assert.equal(version.baseCommit, sha); assert.equal(version.commonGitDirHash, commonHash);
    const { projectId, version: number, createdAt, snapshotHash, ...canonical } = version;
    assert.equal(snapshotHash, integrationExpectedHash(canonical));
    assert.equal((await create(body)).status, 200);
    assert.equal((await create({ ...body, name: 'Changed content' })).status, 409);
    assert.equal((await create({ ...body, clientRequestId: `${tag}-stale`, registeredKvVersion: 1 })).status, 409);
    assert.equal(await db.aiProject.count({ where: { accountId: accounts[0] } }), 1);
    assert.equal(await db.aiGithubRepositoryGrant.count({ where: { accountId: accounts[0] } }), 0);
    console.log('REAL_DB_HTTP_CLI_KV_REGISTERED_LOCAL_GIT_PROJECT_HASH_REPLAY_AND_ACCOUNT_ISOLATION_OK');

    if (bridgeFailure) {
        // Route error projection and safe byte-identical retry only. This
        // mode does not claim scheduler or managed-daemon coverage.
        const patch = { ...body, expectedVersion: 1 };
        delete (patch as Partial<typeof body>).clientRequestId;
        const update = async () => {
            const response = await fetch(`${base}/v1/ai-team/projects/${created.body.id}`, {
                method: 'PATCH', headers: { authorization: `Bearer ${accounts[0]}`,
                    'content-type': 'application/json' }, body: JSON.stringify(patch),
                signal: AbortSignal.timeout(25000) });
            return { status: response.status, retryAfter: response.headers.get('retry-after'),
                body: await response.json() as any };
        };
        failBridge = true;
        const unavailable = await update();
        assert.equal(unavailable.status, 503);
        assert.equal(unavailable.retryAfter, '2');
        assert.deepEqual(unavailable.body, { errorCode: 'AI_RPC_BRIDGE_UNAVAILABLE' });
        assert.equal((await db.aiProject.findUniqueOrThrow({ where: { id: created.body.id } })).currentVersion, 1);
        assert.equal(await db.aiProjectVersion.count({ where: { projectId: created.body.id } }), 1);
        failBridge = false;
        assert.equal((await update()).status, 200);
        assert.equal((await update()).status, 409, 'Stale CAS must remain a business conflict');
        assert.equal(await db.aiProjectVersion.count({ where: { projectId: created.body.id } }), 2);
        console.log('REAL_HTTP_PROJECT_CREATE_UPDATE_BRIDGE_503_SAFE_RETRY_AND_BUSINESS_409_OK fixtureRpc=true managedDaemon=false');
    } else {
    let dispatched: any;
    const dispatchSocket: any = { connected: true, timeout: () => dispatchSocket,
        emitWithAck: async (_event: string, input: any) => {
            dispatched = input.params;
            AiExecutionCapabilitySchema.parse(dispatched.executionCapability);
            assert.equal(dispatched.projectId, projectId);
            assert.ok(dispatched.projectSnapshot, 'Scheduler omitted fixed Project snapshot');
            validateProjectSnapshot(dispatched.projectSnapshot, machineId, repo);
            return { accepted: true };
        } };
    getOrCreateUserRpcListeners(accounts[0]).set(`${machineId}:orchestrator-dispatch`, dispatchSocket);
    let oldRuntime = runtimeUpgradeRejection;
    const featureSocket: any = { connected: true, timeout: () => featureSocket,
        emitWithAck: async (_event: string, input: any) => ({ nonce: input.params.nonce,
            machineId, protocolVersion: 1, executionCapabilityVersion: 1,
            ...(oldRuntime ? {} : { structuredFinalResponseVersion: 1, deliveryProofVersion: 1 }) }) };
    getOrCreateUserRpcListeners(accounts[0]).set(`${machineId}:orchestrator-features`, featureSocket);
    const agent = await db.aiAgent.create({ data: { accountId: accounts[0], name: tag, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', model: 'default', instructions: '', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: false } } });
    const call = async (path: string, method: string, body: unknown) => {
        const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(25_000),
            headers: { authorization: `Bearer ${accounts[0]}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any };
    };
    const rule = await call('/v1/ai-team/autopilots', 'POST', { projectId, agentId: agent.id, name: tag,
        prompt: 'Read README in the fixed local Project. No Issue or PR.', triggerKind: 'manual', action: 'run_only', concurrencyPolicy: 'queue' });
    assert.equal(rule.status, 201);
    assert.equal((await call(`/v1/ai-team/autopilots/${rule.body.id}/status`, 'PATCH', { enabled: true })).status, 200);
    const triggered = await call(`/v1/ai-team/autopilots/${rule.body.id}/run`, 'POST', { clientRequestId: tag });
    assert.equal(triggered.status, 202);
    await autopilotRunTick(new Date(), accounts[0]);
    const planned = await db.aiAutopilotRun.findUniqueOrThrow({ where: { id: triggered.body.id } });
    assert.equal(planned.status, 'submitted'); assert.ok(planned.orchestratorRunId);
    if (runtimeUpgradeRejection) {
        const frozen = await db.orchestratorRun.findUniqueOrThrow({ where: { id: planned.orchestratorRunId! } });
        AiRuntimeContractSchema.parse((frozen.metadata as any).aiRuntimeContract);
        assert.deepEqual((frozen.metadata as any).aiRuntimeContract, {
            kind: 'work_item', structuredFinalResponseVersion: 1, deliveryProofVersion: 1,
        }, 'Public Autopilot did not freeze the Server runtime contract');
        await orchestratorSchedulerTick(new Date(), accounts[0]);
        const rejectedTasks = await db.orchestratorTask.findMany({ where: { runId: frozen.id },
            select: { id: true, status: true, errorCode: true, nextAttemptAt: true } });
        assert.equal(rejectedTasks.length, 1);
        assert.equal(rejectedTasks[0].status, 'failed');
        assert.equal(rejectedTasks[0].errorCode, 'UPGRADE_REQUIRED');
        assert.equal(rejectedTasks[0].nextAttemptAt, null);
        const rejectedAttempts = await db.orchestratorExecution.findMany({ where: { runId: frozen.id },
            select: { id: true, status: true, errorCode: true, childSessionId: true } });
        assert.equal(rejectedAttempts.length, 1);
        assert.equal(rejectedAttempts[0].status, 'failed');
        assert.equal(rejectedAttempts[0].errorCode, 'UPGRADE_REQUIRED');
        assert.equal(rejectedAttempts[0].childSessionId, null);
        assert.equal(dispatched, undefined, 'Unsupported runtime received dispatch RPC');
        // A later compatible machine registration must not silently replay
        // this already rejected execution, even after retry backoff elapses.
        oldRuntime = false;
        for (let tick = 1; tick <= 4; tick++)
            await orchestratorSchedulerTick(new Date(Date.now() + tick * 10_000), accounts[0]);
        assert.equal(dispatched, undefined);
        assert.deepEqual(await db.orchestratorExecution.findMany({ where: { runId: frozen.id },
            select: { id: true, status: true, errorCode: true, childSessionId: true } }), rejectedAttempts);
        assert.deepEqual(await db.orchestratorTask.findMany({ where: { runId: frozen.id },
            select: { id: true, status: true, errorCode: true, nextAttemptAt: true } }), rejectedTasks);
        assert.equal(await db.aiGithubIssueIntent.count({ where: { accountId: accounts[0] } }), 0);
        console.log('REAL_PUBLIC_LOCAL_PROJECT_AUTOPILOT_FROZEN_RUNTIME_UPGRADE_NO_DISPATCH_NO_REPLAY_OK fixtureRpc=true managedDaemon=false');
    } else {
    if (snapshotReadFailure) {
        const beforeTasks = await db.orchestratorTask.findMany({ where: { runId: planned.orchestratorRunId! },
            select: { id: true, status: true, errorCode: true }, orderBy: { id: 'asc' } });
        const beforeAttempts = await db.orchestratorExecution.count({ where: { runId: planned.orchestratorRunId! } });
        const transaction = db.$transaction;
        let injected = false;
        // Only this process's scoped scheduler transaction and this owned Run
        // receive a real PostgreSQL read error. No shared table/schema mutation.
        (db as any).$transaction = (callback: any, options: any) => transaction.call(db, async tx => {
            const scoped = new Proxy(tx, { get(target, property) {
                if (property !== 'aiWorkItem') return Reflect.get(target, property);
                return new Proxy(target.aiWorkItem, { get(model, method) {
                    if (method !== 'findFirst') return Reflect.get(model, method);
                    return async (query: any) => {
                        if (!injected && query.where?.orchestratorRunId === planned.orchestratorRunId) {
                            injected = true;
                            await tx.$queryRaw`SELECT 1 / 0`;
                        }
                        return model.findFirst(query);
                    };
                } });
            } });
            return callback(scoped);
        }, options);
        try {
            await assert.rejects(orchestratorSchedulerTick(new Date(), accounts[0]));
            assert.equal(injected, true, 'Read-error barrier never reached the owned frozen snapshot');
        } finally { (db as any).$transaction = transaction; }
        assert.equal(dispatched, undefined, 'RPC was sent despite failed snapshot read');
        assert.deepEqual(await db.orchestratorTask.findMany({ where: { runId: planned.orchestratorRunId! },
            select: { id: true, status: true, errorCode: true }, orderBy: { id: 'asc' } }), beforeTasks);
        assert.equal(await db.orchestratorExecution.count({ where: { runId: planned.orchestratorRunId! } }), beforeAttempts);
        console.log('REAL_DB_SCHEDULER_SNAPSHOT_SQL_FAILURE_ROLLBACK_NO_FALSE_IDENTITY_FAILURE_OK');
    }
    await orchestratorSchedulerTick(new Date(), accounts[0]);
    assert.ok(dispatched, 'Actual scheduler never dispatched the Project task');
    assert.equal(dispatched.projectSnapshot.version, 1); assert.equal(dispatched.projectSnapshot.baseCommit, sha);
    assert.equal(dispatched.projectSnapshot.snapshotHash, snapshotHash);
    assert.throws(() => validateProjectSnapshot({ ...dispatched.projectSnapshot, version: 0 }, machineId, repo));
    assert.throws(() => validateProjectSnapshot(dispatched.projectSnapshot, randomUUID(), repo));
    writeFileSync(join(repo, 'second.txt'), 'Owned Project v2 base.\n'); git('add', '.'); git('commit', '-m', 'fixture v2');
    const v2 = await call(`/v1/ai-team/projects/${projectId}`, 'PATCH', { kind: 'local', machineId,
        registeredKvVersion: 0, ...request, expectedVersion: 1 });
    assert.equal(v2.status, 200);
    const work = await db.aiWorkItem.findUniqueOrThrow({ where: { id: planned.workItemId! } });
    assert.equal(work.projectVersion, 1);
    const run = await db.orchestratorRun.findUniqueOrThrow({ where: { id: planned.orchestratorRunId! } });
    const task = await db.orchestratorTask.findUniqueOrThrow({ where: { id: dispatched.taskId } });
    const frozen = await db.$transaction((tx) => loadDispatchProjectSnapshot(tx, { runId: run.id,
        accountId: accounts[0], metadata: run.metadata, taskMachineId: task.targetMachineId,
        taskDirectory: task.workingDirectory, taskBaseCommit: task.baseCommit, dispatchMachineId: machineId }));
    assert.deepEqual(frozen, dispatched.projectSnapshot, 'Project update changed existing task snapshot');
    assert.throws(() => validateProjectSnapshot(frozen!, machineId, repo), /base changed/);
    assert.equal(await db.aiGithubIssueIntent.count({ where: { accountId: accounts[0] } }), 0);
    console.log('REAL_DB_HTTP_LOCAL_AUTOPILOT_ACTUAL_SCHEDULER_CLI_FIXED_SNAPSHOT_AND_BASE_DRIFT_GATE_OK');

    // Release this fixture's first execution, then verify the same Project
    // identity survives an actual authorized Team delegation HTTP request.
    await db.orchestratorTask.update({ where: { id: task.id }, data: { status: 'completed' } });
    await db.orchestratorExecution.updateMany({ where: { taskId: task.id }, data: { status: 'completed' } });
    await db.orchestratorRun.update({ where: { id: run.id }, data: { status: 'completed' } });
    const leaderSettings = { engine: 'codex', model: 'default', instructions: '', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: true };
    await db.aiAgent.update({ where: { id: agent.id }, data: { settings: leaderSettings } });
    const member = await db.aiAgent.create({ data: { accountId: accounts[0], name: `${tag}-member`, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { ...leaderSettings, allowDelegation: false } } });
    const team = await db.aiTeam.create({ data: { accountId: accounts[0], name: tag, description: '', emoji: '', instructions: '', leaderId: agent.id,
        members: { create: [{ agentId: agent.id }, { agentId: member.id }] } } });
    const teamRule = await call('/v1/ai-team/autopilots', 'POST', { projectId, agentId: agent.id, teamId: team.id, name: `${tag}-team`,
        prompt: 'Delegate bounded local Project work. No Issue or PR.', triggerKind: 'manual', action: 'run_only', concurrencyPolicy: 'queue' });
    assert.equal(teamRule.status, 201);
    assert.equal((await call(`/v1/ai-team/autopilots/${teamRule.body.id}/status`, 'PATCH', { enabled: true })).status, 200);
    assert.equal((await call(`/v1/ai-team/autopilots/${teamRule.body.id}/run`, 'POST', { clientRequestId: `${tag}-team` })).status, 202);
    await autopilotRunTick(new Date(), accounts[0]);
    await orchestratorSchedulerTick(new Date(), accounts[0]);
    const parent = await db.orchestratorTask.findUniqueOrThrow({ where: { id: dispatched.taskId } });
    assert.equal(parent.collaborationRole, 'leader_plan');
    assert.equal(dispatched.projectSnapshot.version, 2);
    await db.orchestratorTask.update({ where: { id: parent.id }, data: { status: 'running' } });
    await db.orchestratorExecution.update({ where: { id: dispatched.executionId }, data: { status: 'running' } });
    const delegated = await call(`/v1/ai-team/tasks/${parent.id}/delegations`, 'POST', {
        dispatchToken: dispatched.dispatchToken, capability: dispatched.executionCapability.token,
        delegationKey: `${tag}-member`, assignedAgentId: member.id,
        title: 'Owned Project member', requirements: 'Read README in the same fixed Project.', dependsOnTaskIds: [] });
    assert.equal(delegated.status, 201);
    const child = await db.orchestratorTask.findUniqueOrThrow({ where: { id: delegated.body.taskId } });
    assert.equal(child.targetMachineId, parent.targetMachineId);
    assert.equal(child.workingDirectory, parent.workingDirectory);
    assert.equal(child.baseCommit, parent.baseCommit, 'Project delegated task lost the frozen base identity');
    await orchestratorSchedulerTick(new Date(), accounts[0]);
    assert.equal(dispatched.taskId, child.id, 'Project member never reached actual scheduler dispatch');
    assert.equal(dispatched.projectSnapshot.version, 2);
    const aggregate = await db.orchestratorTask.findFirstOrThrow({ where: { runId: parent.runId, collaborationRole: 'aggregate' } });
    assert.doesNotMatch(aggregate.prompt, /report one GitHub delivery/i,
        'Local run_only aggregate requested a GitHub delivery');
    console.log('REAL_DB_HTTP_LOCAL_PROJECT_TEAM_DELEGATION_INHERITS_FROZEN_BASE_OK');
    // Exercise the new human member run endpoint against this already
    // verified real Project, then pass its dispatch through actual CLI gates.
    const principalCall = async (actor: string, path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${base}/v1/ai-team${path}`, { method, signal: AbortSignal.timeout(25000),
            headers: { authorization: `Bearer ${actor}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
    };
    const workspace = (await principalCall(accounts[0], '/workspaces')).body.items.find((item: any) => item.ownerAccountId === accounts[0]);
    assert.equal((await principalCall(accounts[0], `/workspaces/${workspace.id}/members/${accounts[1]}`, 'PUT', { role: 'member' })).status, 200);
    const sharedPath = `/workspaces/${workspace.id}/projects/${projectId}/run`;
    const sharedInput = { clientRequestId: tag+'shared', agentId: agent.id, title: 'Owned shared local Project', summary: 'Read README without Issue or PR' };
    assert.equal((await principalCall(accounts[1], sharedPath, 'POST', sharedInput)).status, 404);
    const resourceGrant = { memberAccountId: accounts[1], resourceKind: 'project', resourceId: projectId, canView: true, canRun: true, canApprove: false };
    assert.equal((await principalCall(accounts[0], `/workspaces/${workspace.id}/grants`, 'PUT', resourceGrant)).status, 200);
    assert.equal((await principalCall(accounts[1], sharedPath, 'POST', sharedInput)).status, 404, 'Project grant alone bypassed Agent run grant');
    assert.equal((await principalCall(accounts[0], `/workspaces/${workspace.id}/grants`, 'PUT', { ...resourceGrant, resourceKind: 'agent', resourceId: agent.id })).status, 200);
    const shared = await principalCall(accounts[1], sharedPath, 'POST', sharedInput);
    assert.equal(shared.status, 201);
    const sharedReplay = await principalCall(accounts[1], sharedPath, 'POST', sharedInput);
    assert.equal(sharedReplay.status, 200); assert.equal(sharedReplay.body.workItemId, shared.body.workItemId);
    const sharedWork = await db.aiWorkItem.findUniqueOrThrow({ where: { id: shared.body.workItemId } });
    assert.equal(sharedWork.accountId, accounts[0]); assert.equal(sharedWork.projectVersion, 2);
    assert.match(sharedWork.sourceResourceId, new RegExp(accounts[1]+'$'));
    const sharedDetail = await principalCall(accounts[1], `/workspaces/${workspace.id}/work-items/${sharedWork.id}`);
    assert.equal(sharedDetail.status, 200);
    AiWorkspaceWorkItemSchema.parse(sharedDetail.body);
    await orchestratorSchedulerTick(new Date(), accounts[0]);
    assert.equal(dispatched.taskId, shared.body.executionId);
    assert.equal(dispatched.projectSnapshot.version, 2);
    assert.equal((await principalCall(accounts[0], `/workspaces/${workspace.id}/members/${accounts[1]}`, 'DELETE')).status, 204);
    assert.equal((await principalCall(accounts[1], sharedPath, 'POST', { ...sharedInput, clientRequestId: tag+'revoked' })).status, 404);
    assert.equal((await principalCall(accounts[1], `/workspaces/${workspace.id}/work-items/${sharedWork.id}`)).status, 404);
    console.log('REAL_DB_HTTP_HUMAN_MEMBER_RUN_GRANTS_REPLAY_SCHEDULER_CLI_PROJECT_GATE_AND_REVOCATION_OK');

    // First local single-task execution is completed above by an owned DB
    // fixture. Assert the actual human acceptance policy without manufacturing
    // GitHub delivery proof; this does not claim provider output validation.
    const beforeAcceptance = await db.aiWorkItem.findUniqueOrThrow({ where: { id: work.id } });
    assert.equal(beforeAcceptance.deliveryVerificationStatus, 'pending');
    const accepted = await call(`/v1/ai-team/work-items/${work.id}/acceptance`, 'POST', { status: 'approved' });
    assert.equal(accepted.status, 200, 'Completed local run_only incorrectly requires GitHub delivery proof');
    const afterAcceptance = await db.aiWorkItem.findUniqueOrThrow({ where: { id: work.id } });
    assert.equal(afterAcceptance.acceptanceStatus, 'approved');
    assert.equal(afterAcceptance.pullRequestUrl, null);
    assert.equal(await db.aiGithubIssueIntent.count({ where: { accountId: accounts[0] } }), 0);
    assert.equal(await db.aiGithubRepositoryGrant.count({ where: { accountId: accounts[0] } }), 0);
    console.log('REAL_DB_HTTP_LOCAL_RUN_ONLY_APPROVAL_WITHOUT_FAKE_GITHUB_PROOF_OK');
    }
    }

} finally {
    await app.close();
    for (const id of accounts) getOrCreateUserRpcListeners(id).clear();
    await db.aiAutopilot.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiInboundRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiWorkspace.deleteMany({ where: { ownerAccountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiTeam.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiProject.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.userKVStore.deleteMany({ where: { accountId: { in: accounts } } });
    await db.machine.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `local-project-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    console.log('AI_LOCAL_PROJECT_ROOT_FIXTURE_CLEANUP residual=0');
    rmSync(root, { recursive: true, force: true }); await db.$disconnect(); redis.disconnect();
}
