import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import nacl from 'tweetnacl';
import { PrismaClient } from '@prisma/client';
import { aiCliTestArtifact } from './ai-cli-test-artifact.mjs';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');

const tag = `P3SCOPEDUI-${Date.now()}`;
const retryMode = process.env.HAPPY_TEST_BROWSER_RETRY === '1';
const cliArtifact = retryMode || process.env.HAPPY_TEST_CLI_ENTRY
    || process.env.HAPPY_TEST_CLI_TREE_SHA256 || process.env.HAPPY_TEST_CLI_FILE_COUNT
    ? aiCliTestArtifact() : null;
const base = 'http://127.0.0.1:43105';
const web = 'http://127.0.0.1:43106';
const root = mkdtempSync(join(tmpdir(), 'happy-app-scoped-ui-'));
const home = join(root, 'happy-home');
const codexHome = join(root, 'codex-home');
const repo = join(root, 'repo');
chmodSync(root, 0o700);
for (const path of [home, codexHome, repo]) mkdirSync(path, { mode: 0o700 });
const db = new PrismaClient();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const accounts = [];
let daemon;
let browser;

async function createAccount() {
    const keypair = nacl.sign.keyPair();
    const challenge = nacl.randomBytes(32);
    const response = await fetch(`${base}/v1/auth`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            publicKey: b64(keypair.publicKey), challenge: b64(challenge),
            signature: b64(nacl.sign.detached(challenge, keypair.secretKey)),
        }) });
    if (!response.ok) throw new Error(`Account login HTTP ${response.status}`);
    const { token } = await response.json();
    const id = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    const account = { id, token, keypair };
    accounts.push(account);
    return account;
}

async function request(account, path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method,
        headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const value = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, value };
}

function expectStatus(result, status, label) {
    if (result.status !== status) throw new Error(`${label}: expected ${status}, got ${result.status} (${result.value?.error ?? ''})`);
    return result.value;
}

async function poll(label, action, predicate, attempts = 60) {
    for (let i = 0; i < attempts; i++) {
        const value = await action();
        if (predicate(value)) return value;
        await delay(1000);
    }
    throw new Error(`${label} timed out`);
}

function verifiedAnswerFlags(task, expectedLine) {
    const attempt = task?.executions?.at(-1);
    const answer = task?.finalResponse?.trim();
    const attemptAnswer = attempt?.finalResponse?.trim();
    return {
        taskCompleted: task?.status === 'completed',
        attemptCompleted: attempt?.status === 'completed',
        taskAnswerVerified: task?.answerVerified === true,
        attemptAnswerVerified: attempt?.answerVerified === true,
        taskAnswerPresent: Boolean(answer),
        attemptAnswerPresent: Boolean(attemptAnswer),
        answersMatch: Boolean(answer && attemptAnswer && answer === attemptAnswer),
        expectedLinePresent: Boolean(answer?.includes(expectedLine) && attemptAnswer?.includes(expectedLine)),
        noRuntimeLeak: Boolean(answer && attemptAnswer
            && !/tokens used|system prompt|codex banner/i.test(answer)
            && !/tokens used|system prompt|codex banner/i.test(attemptAnswer)),
        rawDiagnosticsHidden: task?.outputText == null && task?.outputSummary == null
            && attempt?.outputText == null && attempt?.outputSummary == null,
    };
}

function allFlagsTrue(flags) {
    return Object.values(flags).every((value) => value === true);
}

async function clean() {
    if (browser) await browser.close().catch(() => undefined);
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
        try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* Already exited. */ }
        await Promise.race([new Promise((done) => daemon.once('exit', done)), delay(5000)]);
        if (daemon.exitCode === null && daemon.signalCode === null) {
            try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* Already exited. */ }
        }
    }
    const ids = accounts.map((item) => item.id);
    if (ids.length) {
        for (const item of accounts) {
            const row = await db.account.findUnique({ where: { id: item.id }, select: { publicKey: true } });
            if (!row || Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(item.keypair.publicKey)) !== 0) {
                throw new Error(`Public key check failed for ${item.id}; refusing cleanup`);
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
        if (await db.account.count({ where: { id: { in: ids } } })) throw new Error('Test accounts remain after cleanup');
        console.log(JSON.stringify({ tag, accountIds: ids, publicKeysMatched: true, residualAccounts: 0 }));
    }
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
}

try {
    const owner = await createAccount();
    const member = await createAccount();
    const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
    git(['init']); git(['config', 'user.name', tag]); git(['config', 'user.email', 'scoped-ui@example.invalid']);
    writeFileSync(join(repo, 'README.md'), `${tag} isolated local project\n`);
    git(['add', '.']); git(['commit', '-m', 'initial']);
    const branch = git(['branch', '--show-current']);
    copyFileSync(join(homedir(), '.codex', 'auth.json'), join(codexHome, 'auth.json'));
    copyFileSync(join(homedir(), '.codex', 'config.toml'), join(codexHome, 'config.toml'));
    chmodSync(join(codexHome, 'auth.json'), 0o600);
    chmodSync(join(codexHome, 'config.toml'), 0o600);
    writeFileSync(join(home, 'access.key'), JSON.stringify({ encryption: {
        publicKey: b64(owner.keypair.publicKey), machineKey: b64(nacl.randomBytes(32)),
    }, token: owner.token }), { mode: 0o600 });
    const cli = cliArtifact?.entry ?? resolve('../happy-cli/bin/happy.mjs');
    const daemonEnv = { ...process.env, HAPPY_HOME_DIR: home, CODEX_HOME: codexHome,
        HAPPY_SERVER_URL: base, HAPPY_DISABLE_CAFFEINATE: 'true' };
    const startDaemon = () => spawn(process.execPath, [cli, 'daemon', 'start-sync'], {
        cwd: resolve('../happy-cli'), env: daemonEnv, detached: true, stdio: 'ignore',
    });
    daemon = startDaemon();
    await poll('daemon state', () => existsSync(join(home, 'daemon.state.json')), Boolean, 30);
    const machine = await poll('Codex runtime', async () => {
        const result = await request(owner, '/v1/orchestrator/context');
        return result.value?.data?.machines?.find((item) => item.dispatchReady && item.providers?.includes('codex'));
    }, Boolean, 60);
    const authPath = join(codexHome, 'auth.json');
    const heldAuthPath = join(root, 'held-auth.json');
    if (retryMode) renameSync(authPath, heldAuthPath);
    const repoId = randomUUID();
    const kv = expectStatus(await request(owner, '/v1/kv', 'POST', { mutations: [{
        key: `repos:${machine.machineId}`, version: -1,
        value: Buffer.from(JSON.stringify([{ id: repoId, path: repo, displayName: tag,
            defaultTargetBranch: branch }])).toString('base64'),
    }] }), 200, 'registered repo');
    const project = expectStatus(await request(owner, '/v1/ai-team/projects', 'POST', {
        kind: 'local', name: tag, clientRequestId: randomUUID(), machineId: machine.machineId,
        registeredRepoId: repoId, registeredKvVersion: kv.results[0].version,
        workingDirectory: repo, defaultBranch: branch,
    }), 201, 'local project');
    const agent = expectStatus(await request(owner, '/v1/ai-team/agents', 'POST', {
        name: `${tag} Reader`, role: 'Reviewer', description: 'Read a local file', emoji: '',
        skills: [], responsibilities: [], enabled: true, settings: {
            instructions: '', engine: 'codex', model: 'default', workingDirectory: repo,
            permissionMode: 'read_only', allowDelegation: false,
        },
    }), 201, 'agent');
    const workspace = expectStatus(await request(owner, '/v1/ai-team/workspaces'), 200, 'workspace').items[0];
    expectStatus(await request(owner, `/v1/ai-team/workspaces/${workspace.id}/members/${member.id}`,
        'PUT', { role: 'member' }), 200, 'member');
    const runPath = `/v1/ai-team/workspaces/${workspace.id}/projects/${project.id}/run`;
    const input = { agentId: agent.id, title: `${tag} read README`, summary: 'Read README.md and report its exact first line without changing files.' };
    const denied = await request(member, runPath, 'POST', { ...input, clientRequestId: `${tag}-none` });
    if (denied.status !== 404) throw new Error(`No grant returned ${denied.status}`);
    expectStatus(await request(owner, `/v1/ai-team/workspaces/${workspace.id}/grants`, 'PUT', {
        memberAccountId: member.id, resourceKind: 'project', resourceId: project.id,
        canView: true, canRun: true, canApprove: false,
    }), 200, 'project grant');
    const projectOnly = await request(member, runPath, 'POST', { ...input, clientRequestId: `${tag}-project` });
    if (projectOnly.status !== 404) throw new Error(`Project-only grant returned ${projectOnly.status}`);
    expectStatus(await request(owner, `/v1/ai-team/workspaces/${workspace.id}/grants`, 'PUT', {
        memberAccountId: member.id, resourceKind: 'agent', resourceId: agent.id,
        canView: true, canRun: true, canApprove: false,
    }), 200, 'agent grant');
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome',
        args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ token, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token: member.token, secret: b64(member.keypair.secretKey.subarray(0, 32)) });
    const page = await context.newPage();
    await page.goto(`${web}/settings/workspaces`, { waitUntil: 'domcontentloaded' });
    await page.getByText(project.name, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.getByText(project.name, { exact: true }).first().click();
    await page.getByText(`${tag} Reader`, { exact: true }).last().click();
    await page.getByPlaceholder(/任务标题|Task title/).fill(input.title);
    await page.getByPlaceholder(/任务需求|Task requirements/).fill(input.summary);
    let intercepted = false;
    await page.route(`**${runPath}`, async (route) => {
        if (!intercepted) { intercepted = true; await route.fetch(); await route.abort('failed'); }
        else await route.continue();
    });
    await page.getByText(/运行项目|Run project/).click();
    await page.getByText(/Failed to fetch|Network request failed|Load failed/).waitFor({ timeout: 30000 });
    const beforeReplay = expectStatus(await request(owner, `/v1/ai-team/workspaces/${workspace.id}/work-items`), 200, 'owner work items').items;
    if (beforeReplay.length !== 1) throw new Error(`Lost response created ${beforeReplay.length} work items`);
    await page.getByText(/运行项目|Run project/).click();
    await page.getByText(input.title, { exact: true }).last().waitFor({ timeout: 30000 });
    const afterReplay = expectStatus(await request(owner, `/v1/ai-team/workspaces/${workspace.id}/work-items`), 200, 'replay work items').items;
    if (afterReplay.length !== 1 || afterReplay[0].id !== beforeReplay[0].id) throw new Error('Replay created another WorkItem');
    await page.screenshot({ path: `/tmp/happy-app-${tag}-member-run-390.png`, fullPage: true });
    const workId = afterReplay[0].id;
    if (retryMode) {
        const failed = await poll('ordinary provider failure', async () => {
            const result = await request(owner,
                `/v1/orchestrator/runs/${afterReplay[0].orchestratorRunId}?includeExecutions=true`);
            return result.value?.data?.tasks?.[0]?.status === 'failed' ? result.value.data.tasks[0] : null;
        }, Boolean, 180);
        if (!failed.errorCode || ['APPROVAL_SESSION_INTERRUPTED', 'APPROVAL_OUTCOME_UNCERTAIN'].includes(failed.errorCode)) {
            throw new Error(`Expected a known ordinary provider failure, got ${failed.errorCode}`);
        }
        const originalAttempts = failed.executions;
        const originalSessionId = originalAttempts.at(-1)?.childSessionId;
        const originalExecution = await db.orchestratorExecution.findUnique({
            where: { id: originalAttempts.at(-1).executionId },
            select: { worktreePath: true, branchName: true, baseCommit: true },
        });
        if (!originalSessionId || !originalExecution?.worktreePath || !originalExecution.branchName
            || !originalExecution.baseCommit) throw new Error('Original runtime identity is incomplete');
        renameSync(heldAuthPath, authPath);
        const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ownerContext.addInitScript(({ token, secret }) => {
            localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
        }, { token: owner.token, secret: b64(owner.keypair.secretKey.subarray(0, 32)) });
        const ownerPage = await ownerContext.newPage();
        const executionPath = `${web}/inbox/ai/executions/${failed.taskId}`;
        await ownerPage.goto(executionPath, { waitUntil: 'domcontentloaded' });
        await ownerPage.getByText('Retry task', { exact: true }).waitFor({ timeout: 30000 });
        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-retry-failed-1280.png`, fullPage: true });
        const retryRequests = [];
        const retryResponses = [];
        ownerPage.on('request', (request) => {
            if (request.url().endsWith(`/v1/ai-team/work-items/${workId}/retry`)) {
                retryRequests.push(request.postDataJSON());
            }
        });
        ownerPage.on('response', (response) => {
            if (response.url().endsWith(`/v1/ai-team/work-items/${workId}/retry`)) {
                retryResponses.push(response.status());
            }
        });
        await ownerPage.getByText('Retry task', { exact: true }).click();
        const completed = await poll('actual provider retry completion', async () => {
            const result = await request(owner,
                `/v1/orchestrator/runs/${afterReplay[0].orchestratorRunId}?includeExecutions=true`);
            return result.value?.data?.tasks?.[0]?.status === 'completed' ? result.value.data.tasks[0] : null;
        }, Boolean, 240);
        const finalItems = expectStatus(await request(owner,
            `/v1/ai-team/workspaces/${workspace.id}/work-items`), 200, 'retried WorkItem list').items;
        const finalExecution = await db.orchestratorExecution.findUnique({
            where: { id: completed.executions.at(-1).executionId },
            select: { worktreePath: true, branchName: true, baseCommit: true },
        });
        const retryFlags = {
            retryRequestOnce: retryRequests.length === 1,
            retryHttp200: retryResponses[0] === 200,
            stableMutationIdPresent: Boolean(retryRequests[0]?.clientRequestId),
            oneWorkItem: finalItems.length === 1 && finalItems[0].id === workId,
            sameTask: completed.taskId === failed.taskId,
            oneNewAttempt: completed.executions.length === originalAttempts.length + 1,
            newExecution: completed.executions.at(-1).executionId !== originalAttempts.at(-1).executionId,
            sameSession: completed.executions.at(-1).childSessionId === originalSessionId,
            sameWorktree: finalExecution?.worktreePath === originalExecution.worktreePath,
            sameBranch: finalExecution?.branchName === originalExecution.branchName,
            sameBaseCommit: finalExecution?.baseCommit === originalExecution.baseCommit,
            gitClean: git(['status', '--porcelain']) === '',
            ...verifiedAnswerFlags(completed, `${tag} isolated local project`),
        };
        if (!allFlagsTrue(retryFlags)) {
            throw new Error(`Browser retry verification failed: ${JSON.stringify({
                flags: retryFlags, retryRequestCount: retryRequests.length,
                retryHttpStatuses: retryResponses, workItemCount: finalItems.length,
            })}`);
        }
        await ownerPage.reload();
        await ownerPage.getByText('Completed', { exact: true }).first().waitFor({ timeout: 30000 });
        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-retry-completed-1280.png`, fullPage: true });
        cliArtifact.verify();
        console.log(JSON.stringify({ tag, ownerId: owner.id, memberId: member.id, workId,
            taskId: failed.taskId, firstErrorCode: failed.errorCode,
            firstAttempts: originalAttempts.length, finalAttempts: completed.executions.length,
            firstExecutionId: originalAttempts.at(-1).executionId,
            finalExecutionId: completed.executions.at(-1).executionId,
            sameSession: true, sameWorktree: true, realProviderOutput: true,
            retryRequestCount: retryRequests.length,
            retryHttpStatus: retryResponses[0], workItemCount: finalItems.length, gitClean: true,
            cliBundleSha256: cliArtifact.entrySha256, cliTreeSha256: cliArtifact.treeSha256,
            screenshots: [`/tmp/happy-app-${tag}-retry-failed-1280.png`,
                `/tmp/happy-app-${tag}-retry-completed-1280.png`] }));
    } else {
    const run = await poll('runtime completion', async () => request(owner, `/v1/orchestrator/runs/${afterReplay[0].orchestratorRunId}?includeExecutions=true`),
        (result) => result.value?.data?.tasks?.some((task) => task.status === 'completed') || result.value?.data?.status === 'completed', 180);
    const taskStatus = run.value?.data?.tasks?.map((task) => task.status);
    const task = run.value?.data?.tasks?.[0];
    const answerFlags = verifiedAnswerFlags(task, `${tag} isolated local project`);
    if (!allFlagsTrue(answerFlags)) {
        throw new Error(`Runtime final response verification failed: ${JSON.stringify({ flags: answerFlags })}`);
    }
    const executionId = task?.executions?.at(-1)?.executionId;
    if (!executionId) throw new Error('Actual orchestrator execution ID missing from owner run');
    const audit = expectStatus(await request(owner,
        `/v1/ai-team/executions/${executionId}/events?afterSeq=0&limit=50`), 200, 'runtime audit events');
    const stateBeforeApproval = expectStatus(await request(owner, '/v1/ai-team/state'), 200, 'owner state before approval');
    const projectedExecution = stateBeforeApproval.executions.find((item) => item.id === task.taskId);
    if (projectedExecution?.orchestratorExecutionId !== executionId) {
        throw new Error('Server state has no actual orchestrator execution ID projection');
    }
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ownerContext.addInitScript(({ token, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token: owner.token, secret: b64(owner.keypair.secretKey.subarray(0, 32)) });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${web}/inbox/ai/executions/${task.taskId}`, { waitUntil: 'domcontentloaded' });
    await ownerPage.getByText('Approve', { exact: true }).waitFor({ timeout: 30000 });
    await ownerPage.getByText(/Audit events/).waitFor({ timeout: 30000 });
    await ownerPage.getByText(/tool|result|status/, { exact: false }).first().waitFor({ timeout: 30000 });
    let staleReview;
    const reviewRequests = [];
    if (process.env.HAPPY_TEST_STALE_REVIEW === '1') {
        await ownerContext.setOffline(true);
        const revisionContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await revisionContext.addInitScript(({ token, secret }) => {
            localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
        }, { token: owner.token, secret: b64(owner.keypair.secretKey.subarray(0, 32)) });
        const revisionPage = await revisionContext.newPage();
        await revisionPage.goto(`${web}/inbox/ai/executions/${task.taskId}`, { waitUntil: 'domcontentloaded' });
        await revisionPage.getByText('Request changes', { exact: true }).waitFor({ timeout: 30000 });
        await revisionPage.getByText('Request changes', { exact: true }).click();
        await revisionPage.getByPlaceholder('Required changes').fill(
            'Read README.md again. Include the exact first line and the word SECOND in the final answer. Do not modify files.');
        await revisionPage.getByText('Submit', { exact: true }).last().click();
        const revised = await poll('second execution completion', async () => request(owner,
            `/v1/orchestrator/runs/${afterReplay[0].orchestratorRunId}?includeExecutions=true`),
        (result) => result.value?.data?.tasks?.[0]?.executions?.some((entry) => entry.attempt > 1 && entry.status === 'completed')
            ? result : null, 180);
        const attempts = revised.value.data.tasks[0].executions;
        const secondExecutionId = attempts.find((entry) => entry.attempt > 1 && entry.status === 'completed')?.executionId;
        if (!secondExecutionId || secondExecutionId === executionId) throw new Error('Second execution identity missing');
        await ownerContext.route('**/v1/ai-team/state', (route) => route.abort());
        await ownerContext.setOffline(false);
        ownerPage.on('response', (response) => {
            if (response.url().endsWith(`/v1/ai-team/work-items/${workId}/acceptance`)) {
                reviewRequests.push({ status: response.status(),
                    body: response.request().postDataJSON() });
            }
        });
        await ownerPage.getByText('Approve', { exact: true }).click();
        await ownerPage.getByText('OK', { exact: true }).last().click();
        await ownerPage.getByText(/The result changed/).waitFor({ timeout: 30000 });
        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-stale-review-409-1280.png`, fullPage: true });
        if (reviewRequests[0]?.status !== 409
            || reviewRequests[0]?.body?.reviewedExecutionId !== executionId) {
            throw new Error('Old review did not fail with its displayed execution ID');
        }
        await ownerPage.getByText('OK', { exact: true }).last().click();
        await ownerContext.unroute('**/v1/ai-team/state');
        await ownerPage.reload();
        await ownerPage.getByText('Approve', { exact: true }).waitFor({ timeout: 30000 });
        staleReview = { oldExecutionId: executionId, newExecutionId: secondExecutionId,
            oldApprovalStatus: reviewRequests[0].status,
            sameTask: revised.value.data.tasks[0].taskId === task.taskId,
            attemptCount: attempts.length };
    }
    await ownerPage.getByText('Approve', { exact: true }).click();
    await ownerPage.getByText('OK', { exact: true }).last().click();
    const accepted = await poll('browser approval', () => request(owner,
        `/v1/ai-team/workspaces/${workspace.id}/work-items/${workId}`),
    (result) => result.value?.acceptanceStatus === 'approved' ? result : null, 30);
    const state = expectStatus(await request(owner, '/v1/ai-team/state'), 200, 'owner state');
    const workState = state.workItems.find((item) => item.id === workId);
    const executionState = state.executions.find((item) => item.id === task.taskId);
    if (workState?.status !== 'done' || executionState?.orchestratorExecutionId !== executionId) {
        if (!staleReview || workState?.status !== 'done'
            || executionState?.orchestratorExecutionId !== staleReview.newExecutionId) {
            throw new Error('Done status or audit execution projection did not match actual run');
        }
    }
    if (staleReview) {
        const latestState = expectStatus(await request(owner,
            `/v1/orchestrator/runs/${afterReplay[0].orchestratorRunId}?includeExecutions=true`), 200, 'approved revision');
        const latestId = latestState.data.tasks[0].executions.at(-1).executionId;
        if (latestId !== staleReview.newExecutionId
            || reviewRequests[1]?.status !== 200
            || reviewRequests[1]?.body?.reviewedExecutionId !== latestId) {
            throw new Error('Refreshed review did not approve the displayed second execution');
        }
        staleReview.newApprovalStatus = reviewRequests[1].status;
    }
    await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-owner-approve-1280.png`, fullPage: true });
    const detail = await request(member, `/v1/ai-team/workspaces/${workspace.id}/work-items/${workId}`);
    await page.getByLabel(/刷新工作任务|Refresh work items/).click();
    const memberAuditId = detail.value?.orchestratorExecutionId;
    if (!memberAuditId) throw new Error('Scoped WorkItem did not expose the actual audit execution ID');
    const memberAudit = expectStatus(await request(member,
        `/v1/ai-team/executions/${memberAuditId}/events?afterSeq=0&limit=50`), 200, 'member audit events');
    await page.getByText(/Audit events/).waitFor({ timeout: 30000 });
    if (!memberAudit.items?.length) throw new Error('Member audit events were empty');
    await page.mouse.wheel(0, 700);
    await page.screenshot({ path: `/tmp/happy-app-${tag}-approved-390.png`, fullPage: true });
    let cancellation;
    if (process.env.HAPPY_TEST_CANCEL === '1' || process.env.HAPPY_TEST_OFFLINE_CANCEL === '1') {
        await page.getByPlaceholder(/任务标题|Task title/).fill(`${tag} cancellation`);
        await page.getByPlaceholder(/任务需求|Task requirements/).fill(
            'Run the shell command sleep 90 before reading README.md. Report its first line afterward. Do not change files.');
        await page.getByText(/运行项目|Run project/).click();
        const workItems = await poll('second work item', async () =>
            (await request(owner, `/v1/ai-team/workspaces/${workspace.id}/work-items`)).value?.items,
        (items) => items?.length === 2 ? items : null, 30);
        const cancelWork = workItems.find((item) => item.id !== workId);
        const cancelRun = await poll('cancellable runtime', () => request(owner,
            `/v1/orchestrator/runs/${cancelWork.orchestratorRunId}?includeExecutions=true`),
        (result) => result.value?.data?.tasks?.[0]?.status === 'running' ? result : null, 45);
        const cancelTaskId = cancelRun.value.data.tasks[0].taskId;
        const offline = process.env.HAPPY_TEST_OFFLINE_CANCEL === '1';
        if (offline) {
            process.kill(-daemon.pid, 'SIGKILL');
            await new Promise((done) => daemon.once('exit', done));
        }
        await ownerPage.goto(`${web}/inbox/ai/executions/${cancelTaskId}`);
        await ownerPage.getByText('Cancel task', { exact: true }).waitFor({ timeout: 30000 });
        await ownerPage.getByText('Cancel task', { exact: true }).click();
        await ownerPage.getByText('OK', { exact: true }).last().click();
        await delay(1500);
        const statuses = [];
        for (let i = 0; i < (offline ? 90 : 60); i++) {
            const current = await request(owner,
                `/v1/orchestrator/runs/${cancelWork.orchestratorRunId}?includeExecutions=true`);
            const runData = current.value?.data;
            const value = { run: runData?.status, task: runData?.tasks?.[0]?.status,
                execution: runData?.tasks?.[0]?.executions?.at(-1)?.status };
            if (!statuses.length || JSON.stringify(statuses.at(-1)) !== JSON.stringify(value)) statuses.push(value);
            if (['cancelled', 'failed', 'completed'].includes(value.run)
                && !['running', 'dispatching'].includes(value.task)) break;
            await delay(1000);
        }
        await ownerPage.reload();
        await ownerPage.getByText('Cancelled', { exact: true }).first().waitFor({ timeout: 30000 });
        await ownerPage.screenshot({ path: `/tmp/happy-app-${tag}-cancel-1280.png`, fullPage: true });
        cancellation = { workId: cancelWork.id, offline, statuses,
            terminal: statuses.at(-1)?.run === 'cancelled' && statuses.at(-1)?.task === 'cancelled' };
        if (offline && cancellation.terminal) {
            const count = cancelRun.value.data.tasks[0].executions.length;
            daemon = startDaemon();
            await poll('daemon reconnect', async () => {
                const context = await request(owner, '/v1/orchestrator/context');
                return context.value?.data?.machines?.some((item) => item.dispatchReady
                    && item.providers?.includes('codex'));
            }, Boolean, 60);
            await delay(2000);
            const afterReconnect = expectStatus(await request(owner,
                `/v1/orchestrator/runs/${cancelWork.orchestratorRunId}?includeExecutions=true`), 200, 'reconnected cancelled run');
            cancellation.reconnectedStable = afterReconnect.data.status === 'cancelled'
                && afterReconnect.data.tasks[0].status === 'cancelled'
                && afterReconnect.data.tasks[0].executions.length === count;
            if (!cancellation.reconnectedStable) throw new Error('Cancelled run resurrected after daemon reconnect');
        }
    }
    expectStatus(await request(owner, `/v1/ai-team/workspaces/${workspace.id}/members/${member.id}`, 'DELETE'), 204, 'revoke member');
    const revoked = await request(member, `/v1/ai-team/workspaces/${workspace.id}/work-items/${workId}`);
    const revokedRun = await request(member, runPath, 'POST', { ...input, clientRequestId: `${tag}-revoked` });
    const revokedAudit = await request(member,
        `/v1/ai-team/executions/${memberAuditId}/events?afterSeq=0&limit=50`);
    if (revoked.status !== 404 || revokedRun.status !== 404 || revokedAudit.status !== 404) {
        throw new Error(`Revocation failed: ${revoked.status}/${revokedRun.status}/${revokedAudit.status}`);
    }
    console.log(JSON.stringify({ tag, ownerId: owner.id, memberId: member.id, projectId: project.id,
        workId, noGrant: denied.status, projectOnly: projectOnly.status, replayCount: afterReplay.length,
        runtimeTaskStatus: taskStatus, workStatus: workState.status, auditIdMatchesRun: true,
        safeFinalResponse: true,
        auditEventCount: audit.items?.length ?? 0, auditKinds: [...new Set((audit.items ?? []).map((item) => item.kind))],
        approvalStatus: accepted.status,
        acceptance: detail.value?.acceptanceStatus, delivery: detail.value?.deliveryVerificationStatus,
        memberAuditCount: memberAudit.items.length,
        revokedDetail: revoked.status, revokedRun: revokedRun.status, revokedAudit: revokedAudit.status,
        screenshot: `/tmp/happy-app-${tag}-member-run-390.png`,
        ownerScreenshot: `/tmp/happy-app-${tag}-owner-approve-1280.png`, cancellation, staleReview }));
    }
} finally {
    try { await clean(); } finally { cliArtifact?.verify(); }
}
