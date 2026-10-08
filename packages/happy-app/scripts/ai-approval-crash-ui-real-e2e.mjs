import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { aiCliTestArtifact } from './ai-cli-test-artifact.mjs';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
const mode = process.argv[2];
assert.ok(mode === 'pending' || mode === 'invoking');
const tag = `APPCRASHUI-${mode}-${Date.now()}`;
const cliArtifact = aiCliTestArtifact();
const root = mkdtempSync(join(tmpdir(), `happy-app-crash-${mode}-`));
const db = new PrismaClient();
const apiBase = 'http://127.0.0.1:43105';
const webBase = 'http://localhost:43106';
let browser;
let token;
let accountId;
let accountPublicKey;
let child;
let output = '';

async function api(path) {
    const response = await fetch(`${apiBase}${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, `${path} HTTP ${response.status}`);
    return response.json();
}

try {
    child = spawn(process.execPath, [resolve('../happy-cli/scripts/ai-team-p0-real-e2e.mjs')], {
        cwd: resolve('../happy-cli'), env: { ...process.env, TMPDIR: root,
            HAPPY_TEST_CLI_ENTRY: cliArtifact.entry,
            HAPPY_TEST_CLI_SHA256: cliArtifact.entrySha256,
            ...(cliArtifact.treeSha256 && {
                HAPPY_TEST_CLI_TREE_SHA256: cliArtifact.treeSha256,
                HAPPY_TEST_CLI_FILE_COUNT: String(cliArtifact.fileCount),
            }),
            HAPPY_TEST_SERVER_URL: apiBase, HAPPY_TEST_APPROVAL_PUBLIC: '1',
            HAPPY_TEST_APPROVAL_PENDING_KILL: mode === 'pending' ? '1' : '0',
            HAPPY_TEST_APPROVAL_KILL: mode === 'invoking' ? '1' : '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        output = `${output}${chunk.toString()}`.slice(-10000);
    });
    for (let i = 0; i < 240; i++) {
        const home = readdirSync(root).find((entry) => entry.startsWith('happy-p0-cli-real-'));
        const keyPath = home ? join(root, home, 'happy-home', 'access.key') : null;
        if (keyPath && existsSync(keyPath)) {
            const key = JSON.parse(readFileSync(keyPath, 'utf8'));
            token = key.token;
            accountPublicKey = key.encryption.publicKey;
            accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
            break;
        }
        await delay(50);
    }
    assert.ok(token, 'Owned CLI test token was not captured');
    const exitCode = await new Promise((done) => child.once('exit', done));
    assert.equal(exitCode, 0, `Actual provider test failed: ${output.slice(-1200)}`);
    assert.ok(output.includes(mode === 'pending'
        ? 'ACTUAL_PENDING_APPROVAL_RESTART_DID_NOT_REPLAY_OPERATION'
        : 'ACTUAL_APPROVAL_UNCERTAIN_REQUIRES_REVIEW'));
    const runs = await db.orchestratorRun.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 1,
        include: { tasks: { include: { executions: true } } } });
    assert.equal(runs.length, 1);
    const task = runs[0].tasks.find((item) => item.executions.length);
    assert.ok(task);
    assert.equal(task.executions.length, 1);
    const attempt = task.executions[0];
    const expected = mode === 'pending' ? 'APPROVAL_SESSION_INTERRUPTED' : 'APPROVAL_OUTCOME_UNCERTAIN';
    assert.equal(attempt.status, 'failed');
    assert.equal(attempt.errorCode, expected);
    assert.equal(task.status, 'failed');
    assert.equal(task.nextAttemptAt, null);
    const state = await api('/v1/ai-team/state');
    const execution = state.executions.find((item) => item.id === task.id);
    assert.ok(execution);
    assert.equal(execution.errorCode, expected);
    assert.equal(execution.orchestratorExecutionId, attempt.id);
    const decisions = await api('/v1/ai-team/decisions?limit=50');
    const decision = decisions.items.find((item) => item.executionId === attempt.id);
    assert.ok(decision);
    if (mode === 'pending') {
        assert.equal(decision.errorCode, expected);
        assert.equal(decision.deliveryStatus, 'blocked');
        assert.equal(decision.status, 'expired');
    } else {
        assert.equal(decision.status, 'decided');
        assert.equal(decision.decision, 'approved');
    }
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript(({ token, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token, secret: randomBytes(32).toString('base64') });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(JSON.stringify({ tag, pageError: error.message.slice(0, 700) })));
    page.on('console', (message) => {
        if (message.type() === 'error') console.log(JSON.stringify({ tag, browserConsoleError: message.text().slice(0, 500) }));
    });
    await page.goto(`${webBase}/inbox/ai/executions/${task.id}`, { waitUntil: 'domcontentloaded' });
    await delay(1500);
    await page.screenshot({ path: `/tmp/${tag}-before-assert-1280.png`, fullPage: true });
    console.log(JSON.stringify({ tag, browserPath: new URL(page.url()).pathname,
        browserText: (await page.locator('body').innerText()).slice(0, 450) }));
    await page.getByText(expected, { exact: true }).first().waitFor({ timeout: 30000 });
    await assert.rejects(page.getByText('Retry task', { exact: true }).waitFor({ timeout: 1200 }));
    const screenshot = `/tmp/${tag}-execution-1280.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.goto(`${webBase}/inbox/ai/decisions`, { waitUntil: 'domcontentloaded' });
    await page.getByText(mode === 'pending' ? 'Expired' : 'Decided', { exact: true }).click();
    await page.getByText(expected, { exact: true }).first().waitFor({ timeout: 30000 });
    const historyScreenshot = `/tmp/${tag}-decision-1280.png`;
    await page.screenshot({ path: historyScreenshot, fullPage: true });
    await page.getByText('Audit events', { exact: true }).first().click();
    await page.getByText(/^Audit events ·/).waitFor({ timeout: 30000 });
    const auditResponse = await api(`/v1/ai-team/executions/${attempt.id}/events?afterSeq=0&limit=50`);
    assert.ok(auditResponse.items.length > 0, 'Actual provider left no durable execution audit event');
    const auditScreenshot = `/tmp/${tag}-audit-1280.png`;
    await page.screenshot({ path: auditScreenshot, fullPage: true });
    console.log(JSON.stringify({ tag, accountId, mode, executionId: attempt.id, taskId: task.id,
        errorCode: expected, attempts: task.executions.length, decisionStatus: decision.status,
        decision: decision.decision, deliveryStatus: decision.deliveryStatus, auditEvents: auditResponse.items.length,
        screenshot, historyScreenshot, auditScreenshot,
        provider: 'real_codex', sideEffect: mode === 'invoking' ? 'unknown' : 'not_observed' }));
} finally {
    await browser?.close();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (accountId) {
        const row = await db.account.findUnique({ where: { id: accountId }, select: { publicKey: true } });
        assert.ok(row);
        assert.equal(Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(accountPublicKey, 'base64')), 0);
        assert.ok(readdirSync(root).some((entry) => entry.startsWith('happy-p0-cli-real-')));
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.aiConversation.deleteMany({ where: { accountId } });
        await db.aiTeam.deleteMany({ where: { accountId } });
        await db.aiProject.deleteMany({ where: { accountId } });
        await db.aiAgent.deleteMany({ where: { accountId } });
        await db.userKVStore.deleteMany({ where: { accountId } });
        await db.machine.deleteMany({ where: { accountId } });
        await db.account.delete({ where: { id: accountId } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
        console.log(JSON.stringify({ tag, cleanup: 'owned_tmpdir_and_account', residualAccounts: 0,
            publicKeyMatched: true }));
    }
    rmSync(root, { recursive: true, force: true });
    await db.$disconnect();
    cliArtifact.verify();
}
