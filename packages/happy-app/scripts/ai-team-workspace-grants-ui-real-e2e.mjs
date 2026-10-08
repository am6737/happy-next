import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import nacl from 'tweetnacl';
import { PrismaClient } from '@prisma/client';
import { runSkillP2UiCase } from './ai-skill-complete-ui-case.mjs';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
const tag = `P3GRANTSUI-${Date.now()}`;
const base = 'http://127.0.0.1:43105';
const web = 'http://127.0.0.1:43106';
const root = mkdtempSync(join(tmpdir(), 'happy-app-grants-ui-'));
chmodSync(root, 0o700);
const home = join(root, 'home');
const codexHome = join(root, 'codex-home');
const repo = join(root, 'repo');
for (const path of [home, codexHome, repo]) mkdirSync(path, { mode: 0o700 });
if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.searchParams.set('connection_limit', '1');
    process.env.DATABASE_URL = databaseUrl.toString();
}
const db = new PrismaClient();
const accounts = [];
let daemon;
let browser;
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function account() {
    const keypair = nacl.sign.keyPair();
    const challenge = nacl.randomBytes(32);
    const response = await fetch(`${base}/v1/auth`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: b64(keypair.publicKey), challenge: b64(challenge),
            signature: b64(nacl.sign.detached(challenge, keypair.secretKey)) }) });
    if (!response.ok) throw new Error(`Auth HTTP ${response.status}`);
    const { token } = await response.json();
    const id = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    const value = { id, token, keypair };
    accounts.push(value);
    writeFileSync(join(root, 'account-public-keys.json'), JSON.stringify(accounts.map((item) => ({
        id: item.id, publicKey: b64(item.keypair.publicKey),
    }))), { mode: 0o600 });
    return value;
}
async function api(actor, path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method,
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: response.status === 204 ? null : await response.json().catch(() => null) };
}
function expectStatus(result, status, name) {
    if (result.status !== status) throw new Error(`${name}: HTTP ${result.status}, expected ${status}`);
    return result.value;
}
async function poll(action, predicate, name) {
    for (let i = 0; i < 60; i++) {
        const value = await action();
        if (predicate(value)) return value;
        await delay(1000);
    }
    throw new Error(`${name} timed out`);
}
async function pageFor(actor, width) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    await context.addInitScript(({ token, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token: actor.token, secret: b64(actor.keypair.secretKey.subarray(0, 32)) });
    const page = await context.newPage();
    await page.goto(`${web}/settings/workspaces`, { waitUntil: 'domcontentloaded' });
    return page;
}
async function cleanup() {
    if (browser) await browser.close().catch(() => undefined);
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
        try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* Exited. */ }
        await Promise.race([new Promise((done) => daemon.once('exit', done)), delay(5000)]);
        if (daemon.exitCode === null && daemon.signalCode === null) {
            try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* Exited. */ }
        }
    }
    const ids = accounts.map((item) => item.id);
    if (ids.length) {
        for (const item of accounts) {
            const row = await db.account.findUnique({ where: { id: item.id }, select: { publicKey: true } });
            if (!row || Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(item.keypair.publicKey)) !== 0) {
                throw new Error(`Public key mismatch for ${item.id}; cleanup refused`);
            }
        }
        await db.aiAutopilot.deleteMany({ where: { accountId: { in: ids } } });
        await db.aiInboundRequest.deleteMany({ where: { accountId: { in: ids } } });
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: { in: ids } } });
        await db.orchestratorRun.deleteMany({ where: { accountId: { in: ids } } });
        await db.aiConversation.deleteMany({ where: { accountId: { in: ids } } });
        await db.aiTeam.deleteMany({ where: { accountId: { in: ids } } });
        await db.aiProject.deleteMany({ where: { accountId: { in: ids } } });
        await db.aiAgent.deleteMany({ where: { accountId: { in: ids } } });
        await db.userKVStore.deleteMany({ where: { accountId: { in: ids } } });
        await db.machine.deleteMany({ where: { accountId: { in: ids } } });
        await db.account.deleteMany({ where: { id: { in: ids } } });
        if (await db.account.count({ where: { id: { in: ids } } })) throw new Error('Account cleanup incomplete');
        console.log(JSON.stringify({ tag, accountIds: ids, publicKeysMatched: true, residualAccounts: 0 }));
    }
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
}

try {
    const [owner, admin, member] = await Promise.all([account(), account(), account()]);
    const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
    git(['init']); git(['config', 'user.name', tag]); git(['config', 'user.email', 'grants-ui@example.invalid']);
    writeFileSync(join(repo, 'README.md'), `${tag} local project\n`);
    git(['add', '.']); git(['commit', '-m', 'initial']);
    const branch = git(['branch', '--show-current']);
    copyFileSync(join(homedir(), '.codex', 'auth.json'), join(codexHome, 'auth.json'));
    copyFileSync(join(homedir(), '.codex', 'config.toml'), join(codexHome, 'config.toml'));
    chmodSync(join(codexHome, 'auth.json'), 0o600);
    chmodSync(join(codexHome, 'config.toml'), 0o600);
    writeFileSync(join(home, 'access.key'), JSON.stringify({ encryption: {
        publicKey: b64(owner.keypair.publicKey), machineKey: b64(nacl.randomBytes(32)),
    }, token: owner.token }), { mode: 0o600 });
    daemon = spawn(process.execPath, [resolve('../happy-cli/bin/happy.mjs'), 'daemon', 'start-sync'], {
        cwd: resolve('../happy-cli'), detached: true, stdio: 'ignore', env: { ...process.env,
            HAPPY_HOME_DIR: home, CODEX_HOME: codexHome, HAPPY_SERVER_URL: base,
            HAPPY_DISABLE_CAFFEINATE: 'true' },
    });
    await poll(() => existsSync(join(home, 'daemon.state.json')), Boolean, 'daemon');
    const machine = await poll(async () => {
        const result = await api(owner, '/v1/orchestrator/context');
        return result.value?.data?.machines?.find((item) => item.dispatchReady && item.providers?.includes('codex'));
    }, Boolean, 'Codex machine');
    const repoId = randomUUID();
    const kv = expectStatus(await api(owner, '/v1/kv', 'POST', { mutations: [{
        key: `repos:${machine.machineId}`, version: -1,
        value: Buffer.from(JSON.stringify([{ id: repoId, path: repo, displayName: tag,
            defaultTargetBranch: branch }])).toString('base64'),
    }] }), 200, 'registered repo');
    const project = expectStatus(await api(owner, '/v1/ai-team/projects', 'POST', {
        kind: 'local', name: tag, clientRequestId: randomUUID(), machineId: machine.machineId,
        registeredRepoId: repoId, registeredKvVersion: kv.results[0].version,
        workingDirectory: repo, defaultBranch: branch,
    }), 201, 'Project');
    const agentName = `${tag} Agent`;
    const agent = expectStatus(await api(owner, '/v1/ai-team/agents', 'POST', {
        name: agentName, role: 'Reader', description: 'Read files', emoji: '',
        skills: [], responsibilities: [], enabled: true, settings: { instructions: '', engine: 'codex',
            model: 'default', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: false },
    }), 201, 'Agent');
    const workspace = expectStatus(await api(owner, '/v1/ai-team/workspaces'), 200, 'Workspace').items[0];
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM ?? chromium.executablePath(),
        args: ['--no-sandbox'] });
    const ownerPage = await pageFor(owner, 1280);
    await ownerPage.getByText(workspace.name, { exact: true }).first().waitFor();
    if (process.env.HAPPY_TEST_P2_SKILLS === '1') {
        const leaderName = `${tag} Skill Leader`;
        const createdLeader = expectStatus(await api(owner, '/v1/ai-team/agents', 'POST', {
            name: leaderName, role: 'Leader', description: 'Team coordinator', emoji: '',
            skills: [], responsibilities: [], enabled: true, settings: { instructions: '', engine: 'codex',
                model: 'default', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: false },
        }), 201, 'Skill leader');
        if (typeof agent?.id !== 'string' || !agent.id || typeof createdLeader?.id !== 'string'
            || !createdLeader.id || createdLeader.id === agent.id) {
            throw new Error('Skill Agent create response has invalid ID');
        }
        const teamName = `${tag} skill team`;
        const createdTeam = expectStatus(await api(owner, '/v1/ai-team/teams', 'POST', {
            name: teamName, description: 'Skill scope', emoji: '',
            leaderId: createdLeader.id, memberIds: [agent.id, createdLeader.id], instructions: '', currentGoal: '',
        }), 201, 'Skill team');
        if (typeof createdTeam?.id !== 'string' || !createdTeam.id) {
            throw new Error('Skill team create response has no ID');
        }
        const teamState = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'owner Team state');
        const team = teamState.teams.find((item) => item.id === createdTeam.id);
        const reader = teamState.agents.find((item) => item.id === agent.id);
        const leader = teamState.agents.find((item) => item.id === createdLeader.id);
        if (!team || team.id !== createdTeam.id || team.name !== teamName
            || team.leaderId !== createdLeader.id || !team.memberIds.includes(agent.id)
            || !team.memberIds.includes(createdLeader.id)
            || !reader || reader.id !== agent.id || reader.name !== agentName || reader.enabled !== true
            || !leader || leader.id !== createdLeader.id || leader.name !== leaderName || leader.enabled !== true) {
            throw new Error('Created Skill Team/Agents did not match owner state');
        }
        let taskNumber = 0;
        const proof = await runSkillP2UiCase({ page: ownerPage, team, agent: reader, tag, web,
            api: (path) => api(owner, path), outsiderApi: (path) => api(member, path),
            submitReadOnlyTask: async ({ expectedText }) => {
                const title = `${tag} skill run ${++taskNumber}`;
                await ownerPage.goto(`${web}/settings/agents/assign/${reader.id}`, { waitUntil: 'domcontentloaded' });
                await ownerPage.reload({ waitUntil: 'domcontentloaded' });
                await ownerPage.getByText(reader.name, { exact: true }).first().waitFor();
                await ownerPage.getByPlaceholder(/Improve device binding|完善账号切换/).fill(title);
                await ownerPage.getByPlaceholder(/Describe the problem|说明需要解决/)
                    .fill('Read the installed Skill support.txt and report its exact contents. Do not change files.');
                await ownerPage.getByText(team.name, { exact: true }).click();
                const assignmentPath = '/v1/ai-team/assignments';
                const assignmentRequest = ownerPage.waitForRequest((request) =>
                    request.method() === 'POST' && new URL(request.url()).pathname === assignmentPath);
                const assignmentResponse = ownerPage.waitForResponse((response) =>
                    response.request().method() === 'POST' && new URL(response.url()).pathname === assignmentPath);
                await ownerPage.getByText('Create and start', { exact: true }).click();
                const submitted = (await assignmentRequest).postDataJSON();
                if (submitted.agentId !== reader.id || submitted.teamId !== team.id
                    || submitted.title !== title) throw new Error('Skill assignment lost Team/Reader identity');
                if ((await assignmentResponse).status() !== 201) throw new Error('Skill assignment was not created');
                await ownerPage.waitForURL('**/inbox/ai/executions/**');
                const work = await poll(async () => {
                    const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'Skill task state');
                    return state.workItems.find((item) => item.title === title);
                }, Boolean, 'Skill WorkItem');
                if (work.executionIds.length !== 1) throw new Error('Skill task did not create one task');
                return { title, workItemId: work.id, taskId: work.executionIds[0], expectedText };
            },
            readTaskSkillSnapshot: async ({ taskId }) => db.aiTaskSkillSnapshot.findMany({ where: { taskId },
                select: { skillId: true, version: true, contentHash: true } }),
            awaitTaskCompletion: async ({ taskId, workItemId, title, expectedText }) => {
                const task = await poll(async () => db.orchestratorTask.findUnique({ where: { id: taskId },
                    select: { runId: true, status: true, finalResponse: true, errorCode: true } }),
                (row) => row?.status === 'completed' || row?.status === 'failed', 'Skill provider terminal');
                const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'Skill verified answer');
                const execution = state.executions.find((item) => item.id === taskId);
                const work = state.workItems.find((item) => item.id === workItemId && item.title === title);
                const projected = expectStatus(await api(owner,
                    `/v1/orchestrator/runs/${encodeURIComponent(task.runId)}/tasks/${encodeURIComponent(taskId)}`),
                200, 'Skill trusted task projection');
                const trusted = projected?.ok === true && projected.data?.run?.runId === task.runId
                    ? projected.data.task : null;
                const actual = trusted?.finalResponse;
                const exactIncludes = actual?.includes(expectedText) === true;
                if (task.status !== 'completed' || execution?.status !== 'completed'
                    || !work?.executionIds?.includes(taskId) || trusted?.taskId !== taskId
                    || trusted?.status !== 'completed' || trusted?.answerVerified !== true
                    || actual !== task.finalResponse || !exactIncludes) {
                    const digest = (value) => value == null ? null
                        : createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
                    console.error(JSON.stringify({ phase: 'SKILL_EXPECTED_CONTENT_MISMATCH',
                        taskStatus: task.status, stateExecutionStatus: execution?.status ?? 'missing',
                        workMatched: !!work?.executionIds?.includes(taskId),
                        projectedTaskMatched: trusted?.taskId === taskId,
                        projectedStatus: trusted?.status ?? 'missing', errorCode: task.errorCode,
                        answerVerified: trusted?.answerVerified ?? 'missing',
                        finalResponseMatchesDb: actual === task.finalResponse,
                        expectedBytes: Buffer.byteLength(expectedText, 'utf8'), expectedSha256: digest(expectedText),
                        actualBytes: actual == null ? null : Buffer.byteLength(actual, 'utf8'),
                        actualSha256: digest(actual), exactIncludes,
                        trimmedIncludes: actual?.trim().includes(expectedText.trim()) === true,
                        expectedEndsWithLf: expectedText.endsWith('\n'),
                        actualEndsWithLf: actual?.endsWith('\n') ?? null }));
                    throw new Error(`Skill provider did not verify expected content (${task.status}/${task.errorCode ?? 'none'})`);
                }
                if (git(['status', '--porcelain'])) throw new Error('Skill read-only task changed Git repository');
                return { answerVerified: true };
            },
        });
        const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'Skill final state');
        const skillWorks = state.workItems.filter((item) => item.title.startsWith(`${tag} skill run `));
        if (skillWorks.length !== 2 || new Set(skillWorks.map((item) => item.id)).size !== 2
            || !skillWorks.some((item) => item.id === proof.oldTask.workItemId)
            || !skillWorks.some((item) => item.id === proof.newTask.workItemId)) {
            throw new Error('Skill runs did not retain two distinct WorkItems');
        }
        await ownerPage.goto(`${web}/settings/skills`, { waitUntil: 'domcontentloaded' });
        await ownerPage.getByText(`${tag} skill`, { exact: true }).first().click();
        await ownerPage.getByText(`Team: ${team.name}`, { exact: true }).waitFor();
        const screenshot = `/tmp/happy-app-${tag}-p2-skills-1280.png`;
        await ownerPage.screenshot({ path: screenshot, fullPage: true });
        console.log(JSON.stringify({ tag, p2Skills: true, provider: 'real_codex',
            skillId: proof.skillId, workItemCount: skillWorks.length,
            taskIds: [proof.oldTask.taskId, proof.newTask.taskId],
            versionsFrozen: [1, 2], supportHashMatched: true, answerVerified: true,
            gitClean: true, cancelPreservedBinding: proof.cancelPreservedBinding,
            unboundThroughUi: proof.unboundThroughUi, screenshot }));
    } else {
    if (process.env.HAPPY_TEST_AGENT_TRIAL === '1') {
        await ownerPage.goto(`${web}/settings/agents/${agent.id}`, { waitUntil: 'domcontentloaded' });
        await ownerPage.getByText(agentName, { exact: true }).first().waitFor();
        await ownerPage.getByText('Try agent', { exact: true }).click();
        await ownerPage.getByPlaceholder(/Improve device binding|完善账号切换/).fill(`${tag} first trial`);
        await ownerPage.getByPlaceholder(/Describe the problem|说明需要解决/).fill('Read README.md and report its exact first line. Do not change files.');
        let dropped = false;
        const trialRequests = [];
        const trialResponses = [];
        await ownerPage.route('**/v1/ai-team/assignments', async (route) => {
            trialRequests.push(JSON.parse(route.request().postData()));
            const response = await route.fetch();
            trialResponses.push(response.status());
            if (!dropped) { dropped = true; await route.abort('failed'); }
            else await route.fulfill({ response });
        });
        const submitTrial = async () => {
            await ownerPage.getByText('Review and run', { exact: true }).click();
            await ownerPage.getByText('Start', { exact: true }).last().click();
        };
        await submitTrial();
        await ownerPage.getByText('Could not create task', { exact: true }).waitFor();
        await ownerPage.getByText('OK', { exact: true }).last().click();
        const firstItems = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'first trial state')
            .workItems.filter((item) => item.title === `${tag} first trial`);
        if (firstItems.length !== 1) throw new Error(`Trial response loss created ${firstItems.length} WorkItems`);
        await submitTrial();
        await ownerPage.waitForURL('**/inbox/ai/executions/**');
        const replayItems = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'trial replay state')
            .workItems.filter((item) => item.title === `${tag} first trial`);
        if (replayItems.length !== 1 || replayItems[0].id !== firstItems[0].id
            || trialRequests.length !== 2 || trialRequests[0].clientMessageId !== trialRequests[1].clientMessageId) {
            throw new Error('Trial replay did not retain one WorkItem and one mutation identity');
        }
        const trialExecution = await poll(async () => {
            const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'trial execution state');
            return state.executions.find((item) => item.id === replayItems[0].executionIds[0]);
        }, (item) => item?.status === 'completed' || item?.status === 'failed', 'trial execution terminal');
        const actualTask = await db.orchestratorTask.findUnique({ where: { id: trialExecution.id },
            select: { status: true, outputText: true, finalResponse: true, runId: true } });
        if (trialExecution.status !== 'completed' || actualTask?.status !== 'completed'
            || !actualTask.finalResponse?.includes(`${tag} local project`)) {
            throw new Error(`Trial runtime did not read the isolated README (${trialExecution.status})`);
        }
        await ownerPage.reload();
        await ownerPage.getByText('Completed', { exact: true }).first().waitFor();
        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-trial-1280.png`, fullPage: true });
        await ownerPage.goto(`${web}/settings/agents/${agent.id}`, { waitUntil: 'domcontentloaded' });
        await ownerPage.getByText(agentName, { exact: true }).first().waitFor();
        console.log(JSON.stringify({ tag, trialWorkItemId: replayItems[0].id,
            trialTaskId: trialExecution.id, trialRunId: actualTask.runId,
            trialStatus: trialExecution.status,
            trialScreenshot: `/tmp/happy-app-${tag}-trial-1280.png` }));
        if (process.env.HAPPY_TEST_P2_NEW === '1') {
            const workId = replayItems[0].id;
            await ownerPage.goto(`${web}/settings/workspaces/work/${workId}?workspaceId=${workspace.id}`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByText('Work details', { exact: false }).waitFor();
            await ownerPage.getByText('high', { exact: true }).click();
            await ownerPage.getByPlaceholder('Labels, separated by commas').fill(`${tag}, reviewed`);
            await ownerPage.getByText('Save details', { exact: true }).click();
            await poll(() => db.aiWorkItem.findUnique({ where: { id: workId }, select: { priority: true, labels: true } }),
                (row) => row?.priority === 'high' && row.labels.includes(tag), 'metadata UI save');
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-metadata-1280.png`, fullPage: true });
            const snapshot = expectStatus(await api(owner, `/v1/ai-team/work-items/${workId}/metadata`), 200, 'metadata snapshot');
            expectStatus(await api(owner, `/v1/ai-team/work-items/${workId}/metadata`, 'PATCH', {
                expectedRevision: snapshot.metadataRevision, priority: 'urgent', labels: [tag], dueDate: null,
            }), 200, 'concurrent metadata');
            await ownerPage.getByText('low', { exact: true }).click();
            await ownerPage.getByText('Save details', { exact: true }).click();
            await ownerPage.getByText('Work details changed', { exact: false }).waitFor();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-metadata-stale-1280.png`, fullPage: true });
            await ownerPage.getByText('Load current version', { exact: true }).click();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            await ownerPage.getByPlaceholder('Write a comment').fill(`${tag} comment`);
            let droppedComment = false;
            const commentRequests = [];
            await ownerPage.route(`**/v1/ai-team/work-items/${workId}/comments`, async (route) => {
                if (route.request().method() !== 'POST') return route.continue();
                commentRequests.push(JSON.parse(route.request().postData()));
                const response = await route.fetch();
                if (!droppedComment) { droppedComment = true; await route.abort('failed'); }
                else await route.fulfill({ response });
            });
            await ownerPage.getByText('Post comment', { exact: true }).click();
            await ownerPage.getByText('Post comment', { exact: true }).click();
            await poll(() => db.aiWorkItemComment.count({ where: { workItemId: workId, body: `${tag} comment` } }),
                (count) => count === 1, 'comment idempotency');
            if (commentRequests.length !== 2 || commentRequests[0].clientRequestId !== commentRequests[1].clientRequestId) {
                throw new Error('Comment retry changed clientRequestId');
            }
            await ownerPage.getByText('Subscribe to work item', { exact: true }).click();
            const subscription = expectStatus(await api(owner, `/v1/ai-team/work-items/${workId}/metadata`), 200, 'subscription');
            if (!subscription.subscribed) throw new Error('Subscription preference was not persisted');
            expectStatus(await api(owner, `/v1/ai-team/work-items/${workId}/comments`, 'POST', {
                clientRequestId: randomUUID(), body: `${tag} second comment`,
            }), 201, 'second comment');
            for (const suffix of ['comments', 'audit']) {
                await ownerPage.route(`**/v1/ai-team/work-items/${workId}/${suffix}*`, (route) => {
                    if (route.request().method() !== 'GET') return route.continue();
                    const url = new URL(route.request().url());
                    url.searchParams.set('limit', '1');
                    return route.continue({ url: url.toString() });
                });
            }
            await ownerPage.reload();
            await ownerPage.getByText('More comments', { exact: true }).click();
            await ownerPage.getByText(`${tag} comment`, { exact: true }).waitFor();
            await ownerPage.getByText('More records', { exact: true }).click();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-work-collaboration-1280.png`, fullPage: true });
            console.log(JSON.stringify({ tag, p2WorkItemId: workId, commentRequests: commentRequests.length,
                metadataStatus: 'CAS 409 preserved browser draft', subscribed: subscription.subscribed,
                screenshots: [`/tmp/happy-app-${tag}-metadata-1280.png`,
                    `/tmp/happy-app-${tag}-metadata-stale-1280.png`, `/tmp/happy-app-${tag}-work-collaboration-1280.png`] }));
            const beforeAgent = await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id },
                select: { settings: true } });
            await ownerPage.goto(`${web}/settings/agents/templates`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByPlaceholder('Template name').fill(`${tag} template`);
            await ownerPage.getByPlaceholder('Description').fill('Version one');
            await ownerPage.getByPlaceholder('Instructions').fill(`${tag} full draft instructions`);
            await ownerPage.getByText('Save draft', { exact: true }).click();
            await ownerPage.getByText(`${tag} full draft instructions`, { exact: true }).waitFor();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-template-draft-1280.png`, fullPage: true });
            await ownerPage.getByText('Publish', { exact: true }).click();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            const template = await poll(() => db.aiAgentTemplate.findFirst({ where: {
                accountId: owner.id, name: `${tag} template` }, select: { id: true, currentVersion: true } }),
            (row) => row?.currentVersion === 1, 'template v1 publication');
            await ownerPage.getByPlaceholder('Description').fill('Version two');
            await ownerPage.getByText('Save draft', { exact: true }).click();
            await ownerPage.getByText('Publish', { exact: true }).click();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            await poll(() => db.aiAgentTemplate.findUnique({ where: { id: template.id }, select: { currentVersion: true } }),
                (row) => row?.currentVersion === 2, 'template v2 publication');
            await ownerPage.getByText('v1', { exact: true }).first().click();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-template-before-rollback-1280.png`, fullPage: true });
            console.log(JSON.stringify({ tag, templateBeforeRollbackText: (await ownerPage.locator('body').innerText()).slice(-1200),
                screenshot: `/tmp/happy-app-${tag}-template-before-rollback-1280.png` }));
            await ownerPage.getByText('Roll back', { exact: true }).click();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            await poll(() => db.aiAgentTemplate.findUnique({ where: { id: template.id }, select: { currentVersion: true } }),
                (row) => row?.currentVersion === 1, 'template rollback');
            await ownerPage.getByText(agentName, { exact: true }).last().click();
            await ownerPage.getByText('Apply', { exact: true }).click();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            const afterAgent = await poll(() => db.aiAgent.findUnique({ where: { id: agent.id },
                select: { settings: true, templateVersion: { select: { version: true } } } }),
            (row) => row?.templateVersion?.version === 1, 'template applied');
            for (const field of ['engine', 'model', 'workingDirectory', 'permissionMode', 'allowDelegation']) {
                if (beforeAgent.settings[field] !== afterAgent.settings[field]) throw new Error(`Template changed ${field}`);
            }
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-template-applied-1280.png`, fullPage: true });
            console.log(JSON.stringify({ tag, templateId: template.id, publishedVersions: [1, 2],
                rolledBackTo: 1, appliedAgentId: agent.id, runtimeUnchanged: true,
                screenshots: [`/tmp/happy-app-${tag}-template-draft-1280.png`,
                    `/tmp/happy-app-${tag}-template-applied-1280.png`] }));
        }
        if (process.env.HAPPY_TEST_TRIAL_OFFLINE === '1') {
            process.kill(-daemon.pid, 'SIGTERM');
            await Promise.race([new Promise((done) => daemon.once('exit', done)), delay(5000)]);
            await poll(async () => {
                const context = await api(owner, '/v1/orchestrator/context');
                return !context.value?.data?.machines?.some((item) => item.dispatchReady && item.providers?.includes('codex'));
            }, Boolean, 'runtime disconnect');
            await ownerPage.goto(`${web}/settings/agents/${agent.id}`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByText(agentName, { exact: true }).first().waitFor();
            await ownerPage.getByText('Try agent', { exact: true }).click();
            const offlineTitle = `${tag} offline trial`;
            await ownerPage.getByPlaceholder(/Improve device binding|完善账号切换/).fill(offlineTitle);
            await ownerPage.getByPlaceholder(/Describe the problem|说明需要解决/).fill('Read README.md first line only.');
            const responseCount = trialResponses.length;
            await submitTrial();
            await poll(() => trialResponses.length > responseCount, Boolean, 'offline trial response');
            const offlineStatus = trialResponses.at(-1);
            if (offlineStatus >= 400) {
                await ownerPage.getByText('Could not create task', { exact: true }).waitFor();
                await ownerPage.getByText('OK', { exact: true }).last().click();
                if (await ownerPage.getByPlaceholder(/Improve device binding|完善账号切换/).inputValue() !== offlineTitle) {
                    throw new Error('Offline trial lost its title');
                }
            } else {
                await ownerPage.waitForURL('**/inbox/ai/executions/**');
            }
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-trial-offline-1280.png`, fullPage: true });
            const offlineRequests = trialRequests.filter((item) => item.title === offlineTitle);
            if (offlineRequests.length !== 1) throw new Error('Offline trial request missing');
            daemon = spawn(process.execPath, [resolve('../happy-cli/bin/happy.mjs'), 'daemon', 'start-sync'], {
                cwd: resolve('../happy-cli'), detached: true, stdio: 'ignore', env: { ...process.env,
                    HAPPY_HOME_DIR: home, CODEX_HOME: codexHome, HAPPY_SERVER_URL: base,
                    HAPPY_DISABLE_CAFFEINATE: 'true' },
            });
            await poll(async () => {
                const context = await api(owner, '/v1/orchestrator/context');
                return context.value?.data?.machines?.some((item) => item.dispatchReady && item.providers?.includes('codex'));
            }, Boolean, 'runtime reconnect');
            if (offlineStatus >= 400) {
                await submitTrial();
                await poll(() => trialResponses.length >= responseCount + 2, Boolean, 'recovered trial response');
                if (trialResponses.at(-1) >= 400) {
                    await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-trial-retry-error-1280.png`, fullPage: true });
                    throw new Error(`Recovered trial HTTP ${trialResponses.at(-1)}`);
                }
                await ownerPage.waitForURL('**/inbox/ai/executions/**');
            }
            const retriedRequests = trialRequests.filter((item) => item.title === offlineTitle);
            if (retriedRequests.length !== (offlineStatus >= 400 ? 2 : 1)
                || retriedRequests.some((item) => item.clientMessageId !== retriedRequests[0].clientMessageId)) {
                throw new Error('Offline trial retry changed mutation identity');
            }
            const recoveredState = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'recovered trial state');
            if (recoveredState.workItems.filter((item) => item.title === offlineTitle).length !== 1) {
                throw new Error('Recovered trial created duplicate WorkItems');
            }
            const recoveredWork = recoveredState.workItems.find((item) => item.title === offlineTitle);
            const recoveredExecution = await poll(async () => {
                const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'recovered execution state');
                return state.executions.find((item) => item.id === recoveredWork.executionIds[0]);
            }, (item) => item?.status === 'completed' || item?.status === 'failed', 'recovered trial terminal');
            console.log(JSON.stringify({ tag, offlineStatus, recoveredWorkItemId: recoveredState.workItems.find((item) => item.title === offlineTitle).id,
                recoveredExecutionStatus: recoveredExecution.status,
                offlineScreenshot: `/tmp/happy-app-${tag}-trial-offline-1280.png` }));
        }
        if (process.env.HAPPY_TEST_TRIAL_UNSUPPORTED === '1') {
            const unsupportedName = `${tag} unsupported`;
            const unsupported = expectStatus(await api(owner, '/v1/ai-team/agents', 'POST', {
                name: unsupportedName, role: 'Reader', description: 'Read files', emoji: '',
                skills: [], responsibilities: [], enabled: true, settings: { instructions: '', engine: 'gemini',
                    model: 'default', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: false },
            }), 201, 'unsupported Agent');
            await ownerPage.goto(`${web}/settings/agents/${unsupported.id}`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByText(unsupportedName, { exact: true }).first().waitFor();
            await ownerPage.getByText('Try agent', { exact: true }).click();
            const unsupportedTitle = `${tag} unsupported trial`;
            await ownerPage.getByPlaceholder(/Improve device binding|完善账号切换/).fill(unsupportedTitle);
            await ownerPage.getByPlaceholder(/Describe the problem|说明需要解决/).fill('Read README.md without changes.');
            const before = trialResponses.length;
            await submitTrial();
            await poll(() => trialResponses.length > before, Boolean, 'unsupported trial response');
            if (trialResponses.at(-1) !== 400) throw new Error(`Unsupported mode HTTP ${trialResponses.at(-1)}`);
            await ownerPage.getByText('Could not create task', { exact: true }).waitFor();
            await ownerPage.getByText(/Gemini headless read_only is unavailable/).waitFor();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-trial-unsupported-error-1280.png`, fullPage: true });
            await ownerPage.getByText('OK', { exact: true }).last().click();
            if (await ownerPage.getByPlaceholder(/Improve device binding|完善账号切换/).inputValue() !== unsupportedTitle) {
                throw new Error('Unsupported trial lost its draft');
            }
            const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'unsupported state');
            if (state.workItems.some((item) => item.title === unsupportedTitle)) {
                throw new Error('Unsupported trial created a WorkItem');
            }
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-trial-unsupported-1280.png`, fullPage: true });
            console.log(JSON.stringify({ tag, unsupportedStatus: 400,
                unsupportedErrorScreenshot: `/tmp/happy-app-${tag}-trial-unsupported-error-1280.png`,
                unsupportedDraftScreenshot: `/tmp/happy-app-${tag}-trial-unsupported-1280.png` }));
        }
        if (process.env.HAPPY_TEST_APPROVAL === '1') {
            const approvalName = `${tag} approval`;
            const approvalAgent = expectStatus(await api(owner, '/v1/ai-team/agents', 'POST', {
                name: approvalName, role: 'Writer', description: 'Make one reviewed change', emoji: '',
                skills: [], responsibilities: [], enabled: true, settings: { instructions: '', engine: 'codex',
                    model: 'default', workingDirectory: repo, permissionMode: 'approval', allowDelegation: false },
            }), 201, 'approval Agent');
            if (process.env.HAPPY_TEST_APPROVAL_REVOKE === '1') {
                expectStatus(await api(owner, `/v1/ai-team/workspaces/${workspace.id}/members/${admin.id}`,
                    'PUT', { role: 'admin' }), 200, 'temporary approver membership');
            }
            const approvalTitle = `${tag} approval trial`;
            await ownerPage.goto(`${web}/settings/workspaces`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByText(project.name, { exact: true }).first().waitFor();
            await ownerPage.getByText(project.name, { exact: true }).first().click();
            await ownerPage.getByText(approvalName, { exact: true }).last().click();
            await ownerPage.getByPlaceholder(/Task title|任务标题/).fill(approvalTitle);
            await ownerPage.getByPlaceholder(/Task requirements|任务需求/).fill(
                `In this local Git repository, use exactly this shell command to create the file: echo '${tag} approved' > approval-exact.txt. Approve each operation separately. Verify the file bytes, then git add approval-exact.txt and git commit -m 'Add approved file'. Do not use apply_patch or workspace-write. Do not create a PR.`);
            const projectRunResponse = ownerPage.waitForResponse((response) => response.url().includes(`/projects/${project.id}/run`));
            await ownerPage.getByText('Run project', { exact: true }).click();
            const runResponse = await projectRunResponse;
            if (runResponse.status() !== 201) throw new Error(`Approval Project run HTTP ${runResponse.status()}`);
            const approvalWork = await poll(async () => {
                const state = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'approval state');
                return state.workItems.find((item) => item.title === approvalTitle);
            }, Boolean, 'approval WorkItem');
            const decision = await poll(async () => {
                const inbox = await api(owner, '/v1/ai-team/decisions?status=pending&limit=50');
                return inbox.value?.items?.find((item) => item.workItemId === approvalWork.id);
            }, Boolean, 'CLI approval Decision');
            const execution = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId },
                select: { status: true, worktreePath: true, runId: true } });
            if (execution?.status !== 'running' || !execution.worktreePath
                || existsSync(join(execution.worktreePath, 'approval-exact.txt'))) {
                throw new Error('Approval action was not paused before writing');
            }
            if (process.env.HAPPY_TEST_APPROVAL_KILL === '1') {
                process.kill(-daemon.pid, 'SIGKILL');
                await Promise.race([new Promise((done) => daemon.once('exit', done)), delay(5000)]);
                if (existsSync(join(execution.worktreePath, 'approval-exact.txt'))) {
                    throw new Error('Pending approval wrote during daemon disconnection');
                }
                daemon = spawn(process.execPath, [resolve('../happy-cli/bin/happy.mjs'), 'daemon', 'start-sync'], {
                    cwd: resolve('../happy-cli'), detached: true, stdio: 'ignore', env: { ...process.env,
                        HAPPY_HOME_DIR: home, CODEX_HOME: codexHome, HAPPY_SERVER_URL: base,
                        HAPPY_DISABLE_CAFFEINATE: 'true' },
                });
                await poll(async () => {
                    const context = await api(owner, '/v1/orchestrator/context');
                    return context.value?.data?.machines?.some((item) => item.dispatchReady && item.providers?.includes('codex'));
                }, Boolean, 'approval daemon reconnect');
                const resumed = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId },
                    select: { status: true } });
                if (resumed?.status !== 'running') throw new Error(`Original approval execution did not resume: ${resumed?.status}`);
            }
            await ownerPage.goto(`${web}/inbox/ai/decisions`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByText(decision.operationId, { exact: false }).first().waitFor();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-approval-pending-1280.png`, fullPage: true });
            const respondStatuses = [];
            await ownerPage.route('**/v1/ai-team/decisions/*/respond', async (route) => {
                const response = await route.fetch();
                respondStatuses.push({ status: response.status(), decisionId: route.request().url().split('/').at(-2) });
                await route.fulfill({ response });
            });
            if (process.env.HAPPY_TEST_APPROVAL_REVOKE === '1') {
                const revokedPage = await pageFor(admin, 1280);
                await revokedPage.goto(`${web}/inbox/ai/decisions`, { waitUntil: 'domcontentloaded' });
                await revokedPage.getByText(decision.operationId, { exact: false }).first().waitFor();
                expectStatus(await api(owner, `/v1/ai-team/workspaces/${workspace.id}/members/${admin.id}`,
                    'DELETE'), 204, 'approver revocation');
                const revokedResponses = [];
                await revokedPage.route('**/v1/ai-team/decisions/*/respond', async (route) => {
                    const response = await route.fetch();
                    revokedResponses.push(response.status());
                    await route.fulfill({ response });
                });
                await revokedPage.getByText('Approve', { exact: true }).first().click();
                await revokedPage.getByText('Approve this request?', { exact: true }).waitFor();
                await revokedPage.getByText('OK', { exact: true }).last().click();
                await poll(() => revokedResponses.at(-1), (status) => status === 404, 'revoked approval rejection');
                if (existsSync(join(execution.worktreePath, 'approval-exact.txt'))) {
                    throw new Error('Revoked approval wrote target file');
                }
                const revokedExecution = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId },
                    select: { status: true } });
                if (revokedExecution?.status === 'completed') throw new Error('Revoked operation completed execution');
                await revokedPage.screenshot({ path: `/tmp/happy-app-${tag}-approval-revoked-1280.png`, fullPage: true });
                console.log(JSON.stringify({ tag, revokedOperationId: decision.operationId, respondStatus: 404,
                    targetFileAbsent: true, originalExecutionStatus: revokedExecution?.status,
                    screenshot: `/tmp/happy-app-${tag}-approval-revoked-1280.png` }));
            } else if (process.env.HAPPY_TEST_APPROVAL_EXPIRE === '1') {
                await db.aiDecisionRequest.update({ where: { id: decision.id },
                    data: { expiresAt: new Date(Date.now() - 1000), status: 'expired' } });
                await ownerPage.reload();
                await ownerPage.getByText('Expired', { exact: true }).click();
                await ownerPage.getByText(decision.operationId, { exact: false }).first().waitFor();
                if (await ownerPage.getByText('Approve', { exact: true }).count()) {
                    throw new Error('Expired operation retained an Approve control');
                }
                const expiredRespond = await api(owner, `/v1/ai-team/decisions/${decision.id}/respond`, 'POST', {
                    version: decision.version, clientRequestId: randomUUID(), decision: 'approved', note: '',
                });
                if (expiredRespond.status !== 409 || existsSync(join(execution.worktreePath, 'approval-exact.txt'))) {
                    throw new Error('Expired approval was accepted or wrote the file');
                }
                const expiredExecution = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId },
                    select: { status: true } });
                if (expiredExecution?.status === 'completed') throw new Error('Expired operation completed execution');
                await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-approval-expired-fixture-1280.png`, fullPage: true });
                console.log(JSON.stringify({ tag, expiredOperationId: decision.operationId, expiryFixture: true,
                    respondStatus: expiredRespond.status, targetFileAbsent: true,
                    originalExecutionStatus: expiredExecution?.status,
                    screenshot: `/tmp/happy-app-${tag}-approval-expired-fixture-1280.png` }));
            } else if (process.env.HAPPY_TEST_APPROVAL_REJECT === '1') {
                await ownerPage.getByText('Reject', { exact: true }).first().click();
                await ownerPage.getByText('Reject request', { exact: true }).waitFor();
                await ownerPage.getByText('Reject', { exact: true }).last().click();
                await poll(() => respondStatuses.length > 0, Boolean, 'rejection respond HTTP');
                if (respondStatuses[0].decisionId !== decision.id || respondStatuses[0].status !== 200) {
                    throw new Error('Rejection did not respond for the reviewed operation');
                }
                const rejected = await poll(async () => {
                    const inbox = await api(owner, '/v1/ai-team/decisions?status=decided&limit=50');
                    return inbox.value?.items?.find((item) => item.id === decision.id);
                }, (item) => item?.decision === 'rejected' && item.deliveryStatus === 'delivered', 'rejection delivery');
                const terminal = await poll(async () => db.orchestratorExecution.findUnique({
                    where: { id: decision.executionId }, select: { status: true },
                }), (item) => item?.status === 'failed' || item?.status === 'cancelled', 'rejected original execution terminal');
                if (existsSync(join(execution.worktreePath, 'approval-exact.txt'))
                    || execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'],
                        { cwd: execution.worktreePath, stdio: 'pipe' }).toString().split('\n').includes('approval-exact.txt')) {
                    throw new Error('Rejected operation wrote or committed the target file');
                }
                await ownerPage.getByText('Decided', { exact: true }).click();
                await ownerPage.getByText('rejected', { exact: false }).first().waitFor();
                await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-approval-rejected-1280.png`, fullPage: true });
                console.log(JSON.stringify({ tag, rejectedOperationId: rejected.operationId,
                    originalExecutionStatus: terminal.status, targetFileAbsentAfterRejection: true,
                    rejectionScreenshot: `/tmp/happy-app-${tag}-approval-rejected-1280.png` }));
            } else {
            await ownerPage.getByText('Approve', { exact: true }).first().click();
            await ownerPage.getByText('Approve this request?', { exact: true }).waitFor();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            await poll(() => respondStatuses.length > 0, Boolean, 'approval respond HTTP');
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-approval-respond-1280.png`, fullPage: true });
            if (respondStatuses[0].decisionId !== decision.id || respondStatuses[0].status !== 200) {
                throw new Error(`Approval respond HTTP ${respondStatuses[0].status}; operation identity matched: ${respondStatuses[0].decisionId === decision.id}`);
            }
            const decided = await poll(async () => {
                const inbox = await api(owner, '/v1/ai-team/decisions?status=decided&limit=50');
                return inbox.value?.items?.find((item) => item.id === decision.id);
            }, Boolean, 'approval decided state');
            const otherPending = (await api(owner, '/v1/ai-team/decisions?status=pending&limit=50'))
                .value?.items?.filter((item) => item.workItemId === approvalWork.id && item.id !== decision.id) ?? [];
            const firstWroteFile = existsSync(join(execution.worktreePath, 'approval-exact.txt'));
            if (firstWroteFile && readFileSync(join(execution.worktreePath, 'approval-exact.txt'), 'utf8') !== `${tag} approved\n`) {
                throw new Error('First approved operation wrote unexpected bytes');
            }
            console.log(JSON.stringify({ tag, approvalWorkItemId: approvalWork.id,
                approvalExecutionId: decision.executionId, operationId: decision.operationId,
                actionHash: decision.actionHash, decisionVersion: decided.version,
                deliveryStatus: decided.deliveryStatus, otherPendingCount: otherPending.length,
                targetFileAbsentBeforeApproval: true, firstOperationWroteExactFile: firstWroteFile,
                approvalScreenshot: `/tmp/happy-app-${tag}-approval-pending-1280.png`,
                approvalResponseScreenshot: `/tmp/happy-app-${tag}-approval-respond-1280.png` }));
            if (process.env.HAPPY_TEST_APPROVAL_WRITE === '1') {
                const target = join(execution.worktreePath, 'approval-exact.txt');
                const approvedOperations = [decision.operationId];
                let terminalStatus;
                for (let step = 0; step < 20; step++) {
                    const readProgress = async () => {
                        const inbox = await api(owner, '/v1/ai-team/decisions?status=pending&limit=50');
                        const current = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId },
                            select: { status: true } });
                        return { items: inbox.value?.items?.filter((item) => item.workItemId === approvalWork.id) ?? [],
                            status: current?.status };
                    };
                    let pending;
                    try {
                        pending = await poll(readProgress,
                            (value) => value.items.length > 0 || ['completed', 'failed', 'cancelled'].includes(value.status),
                            'next operation or terminal');
                    } catch (cause) {
                        const progress = await readProgress();
                        const history = await api(owner, '/v1/ai-team/decisions?status=decided&limit=50');
                        const decidedForWork = history.value?.items?.filter((item) => item.workItemId === approvalWork.id) ?? [];
                        const executions = await db.orchestratorExecution.findMany({ where: { runId: execution.runId },
                            select: { id: true, status: true } });
                        console.log(JSON.stringify({ tag, approvalRecoveryDiagnostic: true,
                            originalExecutionId: decision.executionId, originalStatus: progress.status,
                            pendingCount: progress.items.length,
                            decidedDelivery: decidedForWork.map((item) => ({ operationId: item.operationId,
                                decision: item.decision, deliveryStatus: item.deliveryStatus })), executions }));
                        throw cause;
                    }
                    if (!pending.items.length) { terminalStatus = pending.status; break; }
                    const expectedBytes = `${tag} approved\\n`;
                    const review = pending.items.map((item) => {
                        const raw = (item.payload?.summary ?? '').split('<system-bash> -lc ')[1];
                        const command = raw && ((raw.startsWith('"') && raw.endsWith('"'))
                            || (raw.startsWith("'") && raw.endsWith("'"))) ? raw.slice(1, -1) : raw;
                        return { item, command };
                    });
                    const selected = review.find(({ command }) => {
                        const safeRead = ['pwd', 'git status', 'git status --short --branch',
                            'git status --short', 'git remote -v', 'gh auth status', 'ls -la',
                            'ls -l approval-exact.txt', 'wc -c < approval-exact.txt',
                            'wc -c approval-exact.txt',
                            'od -An -tx1 -v approval-exact.txt', 'od -An -tx1 -c approval-exact.txt',
                            'cat approval-exact.txt',
                            'git diff -- approval-exact.txt', 'git diff --cached --check',
                            'git status --porcelain', 'git show --stat --oneline HEAD'].includes(command)
                            || /^(?:od|wc|cat|ls|sha256sum|xxd|file) [A-Za-z0-9 -]*approval-exact\.txt$/.test(command ?? '')
                            || Boolean(command?.startsWith('rg --files') && !/[;><]/.test(command));
                        const safeVerify = command === `cmp -s approval-exact.txt <(printf '${expectedBytes}') && wc -c approval-exact.txt && od -An -tx1 approval-exact.txt`;
                        const safePipeVerify = command === `printf '${expectedBytes}' | cmp - approval-exact.txt`;
                        const targetWrite = command === `echo '${tag} approved' > approval-exact.txt`;
                        const targetStage = command === 'git add -f -- approval-exact.txt' || command === 'git add approval-exact.txt';
                        const targetCommit = /^git commit -m '[A-Za-z0-9 .,():_-]{1,100}'$/.test(command ?? '');
                        return safeRead || safeVerify || safePipeVerify || targetWrite || targetStage || targetCommit;
                    });
                    if (!selected) {
                        const unreviewed = pending.items[0];
                        await ownerPage.reload();
                        await ownerPage.getByText(unreviewed.operationId, { exact: false }).first().scrollIntoViewIfNeeded();
                        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-approval-unreviewed-1280.png` });
                        throw new Error(`Unreviewed operation ${unreviewed.operationId} (${unreviewed.actionType}); reviewed local commands: ${JSON.stringify(review.map(({ command }) => command))}`);
                    }
                    const next = selected.item;
                    const otherIds = pending.items.filter((item) => item.id !== next.id).map((item) => item.id);
                    const command = selected.command;
                    await ownerPage.reload();
                    const operation = ownerPage.getByText(next.operationId, { exact: false }).first();
                    await operation.waitFor();
                    const priorResponses = respondStatuses.length;
                    await operation.locator('xpath=..').getByText('Approve', { exact: true }).click();
                    await ownerPage.getByText('Approve this request?', { exact: true }).waitFor();
                    await ownerPage.getByText('OK', { exact: true }).last().click();
                    await poll(() => respondStatuses.length > priorResponses, Boolean, 'next approval HTTP');
                    const result = respondStatuses.at(-1);
                    if (result.status !== 200 || result.decisionId !== next.id) {
                        throw new Error(`Next approval HTTP ${result.status}; identity matched: ${result.decisionId === next.id}`);
                    }
                    const readDecision = async () => {
                        const history = await api(owner, '/v1/ai-team/decisions?status=decided&limit=50');
                        return history.value?.items?.find((item) => item.id === next.id);
                    };
                    let delivered;
                    try {
                        delivered = await poll(readDecision,
                            (item) => item?.deliveryStatus === 'delivered', 'operation delivery');
                    } catch (cause) {
                        const latest = await readDecision();
                        const delivery = await db.aiDecisionRequest.findUnique({ where: { id: next.id },
                            select: { errorCode: true, attempts: true, deliveryStatus: true } });
                        const current = await db.orchestratorExecution.findUnique({ where: { id: decision.executionId },
                            select: { status: true } });
                        console.log(JSON.stringify({ tag, approvalRecoveryDiagnostic: true,
                            operationId: next.operationId, decision: latest?.decision,
                            deliveryStatus: latest?.deliveryStatus, errorCode: delivery?.errorCode,
                            deliveryAttempts: delivery?.attempts, originalExecutionStatus: current?.status }));
                        throw cause;
                    }
                    const others = (await api(owner, '/v1/ai-team/decisions?status=pending&limit=50')).value?.items ?? [];
                    if (otherIds.some((id) => !others.some((item) => item.id === id))) {
                        throw new Error('Approving one operation changed another pending decision');
                    }
                    approvedOperations.push(delivered.operationId);
                }
                if (!existsSync(target)) throw new Error('No approved operation wrote the target file');
                const actual = readFileSync(target, 'utf8');
                if (actual !== `${tag} approved\n`) throw new Error('Approved file bytes differ from the reviewed request');
                if (terminalStatus !== 'completed') throw new Error(`Original execution did not complete: ${terminalStatus ?? 'still running'}`);
                const committed = execFileSync('git', ['show', 'HEAD:approval-exact.txt'],
                    { cwd: execution.worktreePath, stdio: 'pipe' }).toString();
                if (committed !== actual) throw new Error('Git commit does not contain the approved bytes');
                console.log(JSON.stringify({ tag, approvalExactBytes: Buffer.byteLength(actual),
                    approvedOperations, targetFileWrittenInOriginalWorktree: true,
                    originalExecutionStatus: terminalStatus, committedExactBytes: Buffer.byteLength(committed) }));
            }
            }
        }
        await ownerPage.goto(`${web}/settings/workspaces`, { waitUntil: 'domcontentloaded' });
        await ownerPage.getByText(workspace.name, { exact: true }).first().waitFor();
    }
    if (process.env.HAPPY_TEST_APPROVAL_REVOKE !== '1') {
    await ownerPage.getByPlaceholder(/Member account ID|成员账号 ID/).fill(admin.id);
    await ownerPage.getByText('admin', { exact: true }).last().click();
    await ownerPage.getByText(/Add or update|添加或更新/).click();
    await ownerPage.getByText(admin.id, { exact: true }).first().waitFor();
    expectStatus(await api(owner, `/v1/ai-team/workspaces/${workspace.id}/members`), 200, 'admin membership');
    await ownerPage.getByText(admin.id, { exact: true }).first().click();
    await ownerPage.getByText('member', { exact: true }).last().click();
    await ownerPage.getByText(/Add or update|添加或更新/).click();
    await poll(async () => api(owner, `/v1/ai-team/workspaces/${workspace.id}/members`),
        (result) => result.value?.items?.find((item) => item.memberAccountId === admin.id)?.role === 'member',
        'role downgrade');
    await ownerPage.getByText(admin.id, { exact: true }).first().click();
    await ownerPage.getByText('admin', { exact: true }).last().click();
    await ownerPage.getByText(/Add or update|添加或更新/).click();
    await ownerPage.reload();
    await poll(async () => api(owner, `/v1/ai-team/workspaces/${workspace.id}/members`),
        (result) => result.value?.items?.find((item) => item.memberAccountId === admin.id)?.role === 'admin',
        'role upgrade');
    const adminPage = await pageFor(admin, 390);
    await adminPage.getByText(workspace.name, { exact: true }).first().waitFor();
    await adminPage.getByPlaceholder(/Member account ID|成员账号 ID/).fill(member.id);
    await adminPage.getByText(/Add or update|添加或更新/).click();
    await adminPage.getByText(member.id, { exact: true }).first().waitFor();
    await adminPage.getByText(project.name, { exact: true }).first().click();
    await adminPage.getByText(member.id, { exact: true }).first().click();
    await adminPage.getByText('View', { exact: true }).click();
    await adminPage.getByText('Run', { exact: true }).click();
    await adminPage.getByText('Approve', { exact: true }).click();
    await adminPage.getByText(/Save access|保存权限/).click();
    await adminPage.getByText(/Replace|确认替换/, { exact: true }).last().click();
    await poll(() => db.aiWorkspaceGrant.findFirst({ where: { workspaceId: workspace.id,
        memberAccountId: member.id, resourceKind: 'project', resourceId: project.id } }),
    (row) => row?.canView && row?.canRun && row?.canApprove, 'Project grant');
    await adminPage.getByText('Agents', { exact: true }).first().click();
    await adminPage.getByText(agentName, { exact: true }).first().click();
    await adminPage.getByText(member.id, { exact: true }).first().click();
    await adminPage.getByText('View', { exact: true }).click();
    await adminPage.getByText('Run', { exact: true }).click();
    await adminPage.getByText('Approve', { exact: true }).click();
    await adminPage.getByText(/Save access|保存权限/).click();
    await adminPage.getByText(/Replace|确认替换/, { exact: true }).last().click();
    await poll(() => db.aiWorkspaceGrant.findFirst({ where: { workspaceId: workspace.id,
        memberAccountId: member.id, resourceKind: 'agent', resourceId: agent.id } }),
    (row) => row?.canView && row?.canRun && row?.canApprove, 'Agent grant');
    const memberPage = await pageFor(member, 390);
    await memberPage.getByText(project.name, { exact: true }).first().waitFor();
    await memberPage.getByText('Agents', { exact: true }).first().click();
    await memberPage.getByText(agentName, { exact: true }).first().waitFor();
    await adminPage.screenshot({ path: `/tmp/happy-app-${tag}-admin-grants-390.png`, fullPage: true });
    await memberPage.screenshot({ path: `/tmp/happy-app-${tag}-member-grants-390.png`, fullPage: true });
    await adminPage.reload();
    await adminPage.getByText(member.id, { exact: true }).first().waitFor();
    await adminPage.getByText(project.name, { exact: true }).first().click();
    await adminPage.getByText(member.id, { exact: true }).first().click();
    await adminPage.getByText('Access loaded', { exact: false }).waitFor();
    await adminPage.getByText('Access loaded', { exact: false }).scrollIntoViewIfNeeded();
    await adminPage.screenshot({ path: `/tmp/happy-app-${tag}-grant-refill-debug-390.png`, fullPage: true });
    for (const label of ['View', 'Run', 'Approve']) {
        const checked = await adminPage.getByRole('checkbox', { name: label }).getAttribute('aria-checked');
        if (checked !== 'true') {
            throw new Error(`Saved ${label} grant was not restored in the browser`);
        }
    }
    await adminPage.screenshot({ path: `/tmp/happy-app-${tag}-grant-refilled-390.png`, fullPage: true });
    const grants = await db.aiWorkspaceGrant.findMany({ where: { workspaceId: workspace.id,
        memberAccountId: member.id }, select: { resourceKind: true, canView: true, canRun: true, canApprove: true } });
    if (grants.length !== 2 || grants.some((row) => !row.canView || !row.canRun || !row.canApprove)) {
        throw new Error('Grant persistence mismatch after browser refresh');
    }
    if (process.env.HAPPY_TEST_P2_NEW === '1') {
        const seen = expectStatus(await api(owner,
            `/v1/ai-team/workspaces/${workspace.id}/grants?memberAccountId=${member.id}`), 200, 'grant revision');
        await adminPage.getByText('Run', { exact: true }).click();
        expectStatus(await api(owner, `/v1/ai-team/workspaces/${workspace.id}/grants`, 'PUT', {
            memberAccountId: member.id, resourceKind: 'project', resourceId: project.id,
            canView: true, canRun: true, canApprove: false, expectedAuthRevision: seen.authRevision,
        }), 200, 'concurrent grant');
        await adminPage.getByText(/Save access|保存权限/).click();
        await adminPage.getByText(/Replace|确认替换/, { exact: true }).last().click();
        await adminPage.getByText('Access changed elsewhere', { exact: false }).waitFor();
        if (await adminPage.getByRole('checkbox', { name: 'Run' }).getAttribute('aria-checked') !== 'false') {
            throw new Error('Grant CAS conflict discarded local draft');
        }
        await adminPage.screenshot({ path: `/tmp/happy-app-${tag}-grant-stale-390.png`, fullPage: true });
        const grantPath = `/v1/ai-team/workspaces/${workspace.id}/grants`;
        const refreshedResponse = adminPage.waitForResponse((response) => {
            const url = new URL(response.url());
            return response.request().method() === 'GET' && url.pathname === grantPath
                && url.searchParams.get('memberAccountId') === member.id;
        });
        await adminPage.getByText('Load current access', { exact: true }).click();
        await adminPage.getByText('OK', { exact: true }).last().click();
        const refresh = await refreshedResponse;
        if (refresh.status() !== 200) throw new Error(`Explicit grant refresh HTTP ${refresh.status()}`);
        const snapshot = await refresh.json();
        const projectGrant = snapshot.grants.find((item) => item.resourceKind === 'project'
            && item.resourceId === project.id);
        if (snapshot.authRevision <= seen.authRevision || projectGrant?.canRun !== true
            || projectGrant?.canApprove !== false) {
            throw new Error('Explicit grant refresh returned an unexpected server snapshot');
        }
        await adminPage.getByText(`Access loaded · rev ${snapshot.authRevision}`, { exact: false }).waitFor();
        await adminPage.getByText('Access changed elsewhere', { exact: false }).waitFor({ state: 'detached' });
        try {
            await poll(async () => ({
                run: await adminPage.getByRole('checkbox', { name: 'Run' }).getAttribute('aria-checked'),
                approve: await adminPage.getByRole('checkbox', { name: 'Approve' }).getAttribute('aria-checked'),
            }), (value) => value.run === 'true' && value.approve === 'false', 'refreshed grant UI');
        } catch {
            console.error(JSON.stringify({ phase: 'GRANT_REFRESH_UI_MISMATCH',
                seenRevision: seen.authRevision, refreshedRevision: snapshot.authRevision,
                expectedRun: projectGrant.canRun, expectedApprove: projectGrant.canApprove,
                actualRun: await adminPage.getByRole('checkbox', { name: 'Run' }).getAttribute('aria-checked'),
                actualApprove: await adminPage.getByRole('checkbox', { name: 'Approve' }).getAttribute('aria-checked') }));
            throw new Error('Explicit grant refresh did not load server snapshot');
        }
        console.log(JSON.stringify({ tag, grantCAS: 409, draftPreserved: true,
            refreshedExplicitly: true, screenshot: `/tmp/happy-app-${tag}-grant-stale-390.png` }));
        const workId = expectStatus(await api(owner, '/v1/ai-team/state'), 200, 'notification WorkItem')
            .workItems.find((item) => item.title === `${tag} first trial`)?.id;
        if (!workId) throw new Error('Notification WorkItem missing');
        expectStatus(await api(member, `/v1/ai-team/work-items/${workId}/subscription`, 'PUT'), 200,
            'member subscription');
        expectStatus(await api(owner, `/v1/ai-team/work-items/${workId}/comments`, 'POST', {
            clientRequestId: randomUUID(), body: `${tag} notification source`,
        }), 201, 'notification source comment');
        const notification = await poll(async () => {
            const result = await api(member, '/v1/ai-team/notifications');
            return result.value?.items?.find((item) => item.workItemId === workId && item.action === 'comment_added');
        }, Boolean, 'member notification');
        await memberPage.goto(`${web}/settings/ai-notifications`, { waitUntil: 'domcontentloaded' });
        await memberPage.getByText('New comment', { exact: true }).waitFor();
        await memberPage.getByText('Mark read', { exact: true }).click();
        await poll(() => db.aiWorkItemNotification.findUnique({ where: { id: notification.id },
            select: { readAt: true } }), (row) => row?.readAt != null, 'notification read');
        await memberPage.screenshot({ path: `/tmp/happy-app-${tag}-notification-read-390.png`, fullPage: true });
        console.log(JSON.stringify({ tag, notificationId: notification.id, notificationWorkItemId: workId,
            notificationRead: true, screenshot: `/tmp/happy-app-${tag}-notification-read-390.png` }));
    }
    await adminPage.getByText(member.id, { exact: true }).first().click();
    await adminPage.getByText(/Remove|移除/).click();
    await adminPage.getByText(/OK|确定/, { exact: true }).last().click();
    await poll(() => api(member, `/v1/ai-team/workspaces/${workspace.id}/resources?kind=project`),
        (result) => result.status === 404, 'revocation');
    expectStatus(await api(member, `/v1/ai-team/workspaces/${workspace.id}/work-items`), 404, 'revoked work items');
    expectStatus(await api(member, `/v1/ai-team/workspaces/${workspace.id}/projects/${project.id}/run`, 'POST', {
        clientRequestId: randomUUID(), agentId: agent.id, title: tag, summary: 'Read README',
    }), 404, 'revoked run');
    await memberPage.reload();
    await memberPage.getByText(project.name, { exact: true }).waitFor({ state: 'detached' });
    if (process.env.HAPPY_TEST_P2_NEW === '1') {
        await memberPage.goto(`${web}/settings/ai-notifications`, { waitUntil: 'domcontentloaded' });
        await memberPage.getByText('No visible notifications', { exact: true }).waitFor();
        const hidden = expectStatus(await api(member, '/v1/ai-team/notifications'), 200, 'revoked notifications');
        if (hidden.items.length) throw new Error('Revoked member can still read notification');
        await memberPage.screenshot({ path: `/tmp/happy-app-${tag}-notification-revoked-390.png`, fullPage: true });
    }
    await memberPage.screenshot({ path: `/tmp/happy-app-${tag}-revoked-390.png`, fullPage: true });
    if (process.env.HAPPY_TEST_AGENT_TRIAL === '1') {
        const team = expectStatus(await api(owner, '/v1/ai-team/teams', 'POST', {
            name: `${tag} team`, description: 'Archive conflict check', emoji: '',
            leaderId: agent.id, memberIds: [agent.id], instructions: '', currentGoal: '',
        }), 201, 'leader team');
        await ownerPage.goto(`${web}/settings/agents/${agent.id}`, { waitUntil: 'domcontentloaded' });
        await ownerPage.getByText(agentName, { exact: true }).first().waitFor();
        await ownerPage.getByLabel('More actions').click();
        await ownerPage.getByText('Archive agent', { exact: true }).click();
        await ownerPage.getByText('Archive', { exact: true }).last().click();
        await ownerPage.getByText(/Assign another team leader before deleting this agent/).waitFor();
        if ((await db.aiAgent.findUnique({ where: { id: agent.id }, select: { archivedAt: true } }))?.archivedAt) {
            throw new Error('Rejected archive changed archivedAt');
        }
        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-archive-rejected-1280.png`, fullPage: true });
        expectStatus(await api(owner, `/v1/ai-team/teams/${team.id}`, 'DELETE'), 204, 'remove leader team');
        await ownerPage.getByLabel('More actions').click();
        await ownerPage.getByText('Archive agent', { exact: true }).click();
        await ownerPage.getByText('Archive', { exact: true }).last().click();
        await poll(() => db.aiAgent.findUnique({ where: { id: agent.id }, select: { archivedAt: true } }),
            (row) => row?.archivedAt != null, 'archived agent');
        console.log(JSON.stringify({ tag, archiveRejectedStatus: 409,
            archiveRejectedScreenshot: `/tmp/happy-app-${tag}-archive-rejected-1280.png`,
            archiveStatus: 'archivedAt set by DELETE' }));
        if (process.env.HAPPY_TEST_P2_NEW === '1') {
            const extra = expectStatus(await api(owner, '/v1/ai-team/agents', 'POST', {
                name: `${tag} archived extra`, role: 'Reader', description: 'Archive pagination', emoji: '',
                skills: [], responsibilities: [], enabled: false, settings: { instructions: '', engine: 'codex',
                    model: 'default', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: false },
            }), 201, 'extra archived Agent');
            expectStatus(await api(owner, `/v1/ai-team/agents/${extra.id}`, 'DELETE'), 204, 'extra archive');
            const otherArchive = expectStatus(await api(admin, '/v1/ai-team/agents/archived?limit=1'), 200,
                'other account archived list');
            if (otherArchive.items.length) throw new Error('Archived Agent leaked across accounts');
            await ownerPage.setViewportSize({ width: 390, height: 850 });
            await ownerPage.route('**/v1/ai-team/agents/archived*', (route) => {
                const url = new URL(route.request().url());
                url.searchParams.set('limit', '1');
                return route.continue({ url: url.toString() });
            });
            await ownerPage.goto(`${web}/settings/agents`, { waitUntil: 'domcontentloaded' });
            await ownerPage.getByText('Archived', { exact: true }).click();
            await ownerPage.getByText('More', { exact: true }).click();
            await ownerPage.getByText(agentName, { exact: true }).waitFor();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-archived-390.png`, fullPage: true });
            await ownerPage.getByLabel(`Restore ${agentName}`).click();
            await ownerPage.getByText('OK', { exact: true }).last().click();
            await poll(() => db.aiAgent.findUnique({ where: { id: agent.id },
                select: { archivedAt: true, enabled: true } }),
            (row) => row?.archivedAt === null && row.enabled === false, 'restored disabled Agent');
            await ownerPage.getByText(agentName, { exact: true }).waitFor({ state: 'detached' });
            await ownerPage.getByText('All', { exact: true }).click();
            await ownerPage.getByText(agentName, { exact: true }).waitFor();
            await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-restored-disabled-390.png`, fullPage: true });
            console.log(JSON.stringify({ tag, restoredAgentId: agent.id, restoredDisabled: true,
                screenshots: [`/tmp/happy-app-${tag}-archived-390.png`,
                    `/tmp/happy-app-${tag}-restored-disabled-390.png`] }));
        }
    }
    console.log(JSON.stringify({ tag, workspaceId: workspace.id, projectId: project.id,
        agentId: agent.id, grantCount: grants.length, revoked: true,
        screenshots: [`/tmp/happy-app-${tag}-admin-grants-390.png`,
            `/tmp/happy-app-${tag}-member-grants-390.png`, `/tmp/happy-app-${tag}-revoked-390.png`] }));
    }
    }
} finally {
    await cleanup();
}
