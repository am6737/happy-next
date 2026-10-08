import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import httpProxy from 'http-proxy';
import { PrismaClient } from '@prisma/client';
import { aiCliTestArtifact } from './ai-cli-test-artifact.mjs';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
const decision = process.argv[2];
assert.ok(decision === 'accepted' || decision === 'rejected');
const tag = `APPTEMPLATEUI-${decision}-${Date.now()}`;
const cliArtifact = aiCliTestArtifact();
const root = mkdtempSync(join(tmpdir(), 'happy-app-template-'));
const base = 'http://127.0.0.1:43105';
const web = 'http://localhost:43106';
const db = new PrismaClient();
const forward = httpProxy.createProxyServer({ target: base, ws: true });
let blockedReview;
let releaseReview;
const reviewArrived = new Promise((done) => { blockedReview = done; });
const proxy = createServer((req, res) => {
    if (req.method === 'POST' && /^\/v1\/ai-team\/agent-templates\/[^/]+\/proposals\/[^/]+\/review$/.test(req.url ?? '')) {
        releaseReview = () => forward.web(req, res);
        blockedReview();
        return;
    }
    forward.web(req, res);
});
proxy.on('upgrade', (req, socket, head) => forward.ws(req, socket, head));
forward.on('error', (_error, _req, response) => {
    if (response && !response.headersSent) response.writeHead(502);
    response?.end();
});
let child;
let browser;
let token;
let accountId;
let accountPublicKey;
let output = '';
async function api(path) {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return response.json();
}
try {
    await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
    child = spawn(process.execPath, [resolve('../happy-cli/scripts/ai-team-p0-real-e2e.mjs')], {
        cwd: resolve('../happy-cli'), env: { ...process.env, TMPDIR: root,
            HAPPY_TEST_SERVER_URL: `http://127.0.0.1:${proxy.address().port}`,
            HAPPY_TEST_CLI_ENTRY: cliArtifact.entry,
            HAPPY_TEST_CLI_SHA256: cliArtifact.entrySha256,
            ...(cliArtifact.treeSha256 && {
                HAPPY_TEST_CLI_TREE_SHA256: cliArtifact.treeSha256,
                HAPPY_TEST_CLI_FILE_COUNT: String(cliArtifact.fileCount),
            }),
            HAPPY_TEST_TEMPLATE_PROPOSAL: '1', HAPPY_TEST_TEMPLATE_REJECT: decision === 'rejected' ? '1' : '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        output = `${output}${chunk.toString()}`.slice(-12000);
    });
    const childExited = new Promise((_, reject) => child.once('exit', async (code) => {
        const failed = accountId ? await db.orchestratorRun.findFirst({ where: { accountId },
            orderBy: { createdAt: 'desc' }, include: { tasks: { include: { executions: true } } } }) : null;
        const work = failed ? await db.aiWorkItem.findFirst({ where: { orchestratorRunId: failed.id } }) : null;
        const projectVersion = work?.projectId && work.projectVersion ? await db.aiProjectVersion.findUnique({
            where: { projectId_version: { projectId: work.projectId, version: work.projectVersion } } }) : null;
        const task = failed?.tasks[0];
        const metadata = failed?.metadata && typeof failed.metadata === 'object' && !Array.isArray(failed.metadata)
            ? failed.metadata : {};
        reject(new Error(`CLI exited before App review, code ${code}: ${JSON.stringify({
            snapshot: projectVersion ? { kind: projectVersion.kind,
                taskBaseCommit: task?.baseCommit ?? null,
                frozenBaseCommit: projectVersion.baseCommit,
                machineMatches: task?.targetMachineId === projectVersion.machineId,
                directoryMatches: task?.workingDirectory === projectVersion.workingDirectory,
                commitMatches: task?.baseCommit === projectVersion.baseCommit,
                metadataProjectMatches: metadata.aiProjectId === work?.projectId,
                metadataVersionMatches: metadata.aiProjectVersion === work?.projectVersion,
                metadataMachineMatches: metadata.aiProjectMachineId === projectVersion.machineId,
                metadataCommitMatches: metadata.aiProjectBaseCommit === projectVersion.baseCommit,
            } : null,
            runStatus: failed?.status, tasks: failed?.tasks.map((task) => ({ status: task.status,
                errorCode: task.errorCode, attempts: task.executions.map((attempt) => ({
                    status: attempt.status, errorCode: attempt.errorCode })) })) })} ${output.slice(-1600)}`));
    }));
    for (let index = 0; index < 240; index++) {
        const dir = readdirSync(root).find((entry) => entry.startsWith('happy-p0-cli-real-'));
        const path = dir ? join(root, dir, 'happy-home', 'access.key') : null;
        if (path && existsSync(path)) {
            const key = JSON.parse(readFileSync(path, 'utf8'));
            token = key.token; accountPublicKey = key.encryption.publicKey;
            accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
            break;
        }
        await delay(50);
    }
    assert.ok(token);
    await Promise.race([reviewArrived, childExited,
        delay(180_000).then(() => { throw new Error(`Provider proposal did not reach review: ${output.slice(-800)}`); })]);
    const templates = await api('/v1/ai-team/agent-templates');
    assert.equal(templates.items.length, 1);
    const template = templates.items[0];
    const result = await api(`/v1/ai-team/agent-templates/${template.id}/proposals`);
    assert.equal(result.items.length, 1);
    const proposal = result.items[0];
    assert.equal(proposal.status, 'pending');
    assert.ok(proposal.sourceExecutionId && proposal.sourceAgentId);
    assert.equal(proposal.frozenVersion, 1);
    assert.equal(proposal.frozenContentHash.length, 64);
    assert.equal(template.currentVersion, 1);
    const agentBefore = await db.aiAgent.findUniqueOrThrow({ where: { id: proposal.sourceAgentId } });
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript(({ token, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token, secret: Buffer.alloc(32, 7).toString('base64') });
    const page = await context.newPage();
    await page.goto(`${web}/settings/agents/templates`, { waitUntil: 'domcontentloaded' });
    await page.getByText(template.name, { exact: true }).click();
    await page.getByText('Execution snapshot', { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText(proposal.sourceExecutionId, { exact: false }).waitFor();
    const beforeScreenshot = `/tmp/${tag}-pending-1280.png`;
    await page.screenshot({ path: beforeScreenshot, fullPage: true });
    await page.getByText(decision === 'accepted' ? 'Accept and publish' : 'Reject', { exact: true }).click();
    await page.getByText(decision === 'accepted' ? 'Accept and publish proposal?' : 'Reject proposal?', { exact: true }).waitFor();
    await page.getByText('OK', { exact: true }).click();
    for (let index = 0; index < 60; index++) {
        const row = await db.aiAgentTemplateProposal.findUniqueOrThrow({ where: { id: proposal.id } });
        if (row.status === decision) break;
        await delay(100);
    }
    const reviewed = await db.aiAgentTemplateProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    assert.equal(reviewed.status, decision);
    const agentAfter = await db.aiAgent.findUniqueOrThrow({ where: { id: proposal.sourceAgentId } });
    assert.deepEqual(agentAfter.settings, agentBefore.settings);
    const current = await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: template.id } });
    assert.equal(current.currentVersion, decision === 'accepted' ? 2 : 1);
    await page.getByText(new RegExp(`^${decision} ·`)).waitFor({ timeout: 30000 });
    const afterScreenshot = `/tmp/${tag}-${decision}-1280.png`;
    await page.screenshot({ path: afterScreenshot, fullPage: true });
    releaseReview(); releaseReview = undefined;
    const exit = await new Promise((done) => child.once('exit', done));
    assert.equal(exit, 0, output.slice(-1000));
    console.log(JSON.stringify({ tag, accountId, proposalId: proposal.id,
        sourceExecutionId: proposal.sourceExecutionId, frozenVersion: proposal.frozenVersion,
        frozenHashMatched: proposal.frozenContentHash === template.versions.find((item) => item.version === 1)?.contentHash,
        decision, currentVersion: current.currentVersion, agentSettingsUnchanged: true,
        provider: 'real_codex_mcp', beforeScreenshot, afterScreenshot }));
} finally {
    await browser?.close();
    if (releaseReview) releaseReview();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    proxy.closeAllConnections();
    await new Promise((done) => proxy.close(done));
    forward.close();
    if (accountId) {
        const row = await db.account.findUnique({ where: { id: accountId }, select: { publicKey: true } });
        assert.ok(row);
        assert.equal(Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(accountPublicKey, 'base64')), 0);
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.aiConversation.deleteMany({ where: { accountId } });
        await db.aiTeam.deleteMany({ where: { accountId } });
        await db.aiAgentTemplate.deleteMany({ where: { accountId } });
        await db.aiProject.deleteMany({ where: { accountId } });
        await db.aiAgent.deleteMany({ where: { accountId } });
        await db.userKVStore.deleteMany({ where: { accountId } });
        await db.machine.deleteMany({ where: { accountId } });
        await db.account.delete({ where: { id: accountId } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
        console.log(JSON.stringify({ tag, cleanup: 'public_key_verified', residualAccounts: 0 }));
    }
    rmSync(root, { recursive: true, force: true });
    await db.$disconnect();
    cliArtifact.verify();
}
process.exit(0);
