import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
const tag = `APPDIAGNOSTIC-${Date.now()}`;
const base = 'http://127.0.0.1:43105';
const web = 'http://localhost:43106';
const runId = `fixture-run-${Date.now()}`;
const taskId = `fixture-task-${Date.now()}`;
const marker = `INTERNAL_RUNTIME_LOG_${randomBytes(8).toString('hex')}`;
const safeAnswer = `SAFE_FINAL_ANSWER_${randomBytes(8).toString('hex')}`;
const db = new PrismaClient();
let browser;
let accountId;
let publicKey;

try {
    const pair = nacl.sign.keyPair();
    publicKey = Buffer.from(pair.publicKey);
    const challenge = nacl.randomBytes(32);
    const login = await fetch(`${base}/v1/auth`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            publicKey: publicKey.toString('base64'),
            challenge: Buffer.from(challenge).toString('base64'),
            signature: Buffer.from(nacl.sign.detached(challenge, pair.secretKey)).toString('base64'),
        }) });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ authToken, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token: authToken, secret }));
    }, { authToken: token, secret: Buffer.from(pair.secretKey.subarray(0, 32)).toString('base64') });
    const page = await context.newPage();
    const task = {
        taskId, seq: 1, taskKey: 'diagnostic', title: 'Fixture completed process',
        status: 'completed', provider: 'codex', model: null, prompt: 'Read README',
        workingDirectory: null, dependsOn: [], retry: { maxAttempts: 1, backoffMs: 0 },
        nextAttemptAt: null, outputSummary: marker, outputText: marker,
        finalResponse: safeAnswer, answerVerified: true, deliveryVerified: false,
        errorCode: null, errorMessage: null, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), executions: [{
            executionId: 'fixture-execution', attempt: 1, status: 'completed',
            machineId: 'fixture-machine', provider: 'codex', model: null,
            childSessionId: null, executionType: 'initial', resumeMessage: null,
            startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
            exitCode: 0, signal: null, errorCode: null, errorMessage: null,
            outputSummary: marker, outputText: marker,
            finalResponse: safeAnswer, answerVerified: true, deliveryVerified: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }],
    };
    let fixtureRequests = 0;
    let currentTask = task;
    await page.route(`**/v1/orchestrator/runs/${runId}/tasks/${taskId}*`, (route) => {
        fixtureRequests += 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            ok: true, data: { run: { runId, title: 'Fixture run', status: 'completed',
                updatedAt: new Date().toISOString() }, task: currentTask },
        }) });
    });
    await page.route(`**/v1/orchestrator/runs/${runId}?*`, (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {
            runId, title: 'Fixture run', status: 'completed', maxConcurrency: 1,
            controllerSessionId: null, createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
            cancelRequestedAt: null,
            summary: { total: 1, queued: 0, running: 0, completed: 1, failed: 0, cancelled: 0 },
            machines: ['fixture-machine'], tasks: [currentTask],
        } }),
    }));
    const screenshots = [];
    for (const [caseName, taskValue, visible] of [
        ['verified', task, true],
        ['false', { ...task, answerVerified: false, executions: [{ ...task.executions[0], answerVerified: false }] }, false],
        ['null', { ...task, answerVerified: null, executions: [{ ...task.executions[0], answerVerified: null }] }, false],
        ['missing', { ...task, answerVerified: undefined,
            executions: [{ ...task.executions[0], answerVerified: undefined }] }, false],
    ]) {
        currentTask = taskValue;
        await page.goto(`${web}/orchestrator/${runId}/task/${taskId}`, { waitUntil: 'domcontentloaded' });
        await page.getByText(/Attempt #1/).waitFor({ timeout: 30000 });
        await page.getByText(/Attempt #1/).click();
        await page.getByText(visible ? safeAnswer : /No verified answer is available here/).last()
            .waitFor({ timeout: 30000 });
        const body = await page.locator('body').innerText();
        assert.ok(body.includes('Completed'));
        assert.equal(body.includes(safeAnswer), visible, `${caseName} answer visibility`);
        assert.ok(!body.includes(marker), `${caseName} leaked runtime diagnostics`);
        assert.ok(!body.includes('Delivery verified'), `${caseName} inferred delivery from answer`);
        const screenshot = `/tmp/${tag}-${caseName}-390.png`;
        await page.screenshot({ path: screenshot, fullPage: true });
        screenshots.push(screenshot);
        await page.goto(`${web}/orchestrator/${runId}`, { waitUntil: 'domcontentloaded' });
        await page.getByText('Fixture completed process').waitFor({ timeout: 30000 });
        const listBody = await page.locator('body').innerText();
        assert.equal(listBody.includes(safeAnswer), visible, `${caseName} run preview visibility`);
        assert.ok(!listBody.includes(marker), `${caseName} run preview leaked diagnostics`);
    }
    assert.ok(fixtureRequests >= 4);
    console.log(JSON.stringify({ tag, accountId, fixture: true, completed: true,
        rawDiagnosticHidden: true, verifiedAnswerVisibleOnlyWhenTrusted: true,
        deliveryNotInferred: true, cases: 4, screenshots }));
} finally {
    await browser?.close();
    if (accountId) {
        const row = await db.account.findUnique({ where: { id: accountId }, select: { publicKey: true } });
        assert.ok(row && Buffer.compare(Buffer.from(row.publicKey, 'hex'), publicKey) === 0);
        await db.account.delete({ where: { id: accountId } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
        console.log(JSON.stringify({ tag, accountId, publicKeyMatched: true, residualAccounts: 0 }));
    }
    await db.$disconnect();
}
