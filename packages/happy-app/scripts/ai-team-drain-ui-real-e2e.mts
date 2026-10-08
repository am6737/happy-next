import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import nacl from 'tweetnacl';
import { db } from '../../happy-server/sources/storage/db';
import { provisionDispatchCapability } from '../../happy-server/sources/app/ai/workspaceAuth';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');

const tag = `P3DRAINUI-${Date.now()}`;
const base = 'http://127.0.0.1:43105';
const web = 'http://127.0.0.1:43106';
const privateDir = mkdtempSync(join(tmpdir(), 'happy-app-drain-ui-'));
chmodSync(privateDir, 0o700);
const keys = nacl.sign.keyPair();
const publicKey = Buffer.from(keys.publicKey).toString('base64');
let accountId = '';
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
const api = async (token: string, path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json().catch(() => null) };
};
try {
    const challenge = nacl.randomBytes(32);
    const auth = await fetch(`${base}/v1/auth`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey, challenge: Buffer.from(challenge).toString('base64'),
            signature: Buffer.from(nacl.sign.detached(challenge, keys.secretKey)).toString('base64') }) });
    assert.equal(auth.status, 200);
    const { token } = await auth.json() as { token: string };
    accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    const run = await db.orchestratorRun.create({ data: { accountId, title: tag,
        status: 'running', tasks: { create: { seq: 1, taskKey: 'drain', provider: 'codex', prompt: '',
            permissionMode: 'read_only', status: 'dispatching', targetMachineId: tag,
            workingDirectory: join(privateDir, 'repo'), branchName: 'fixture-drain' } } }, include: { tasks: true } });
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId: tag, provider: 'codex', status: 'dispatching',
        dispatchToken: randomUUID() } });
    const capability = await provisionDispatchCapability({ accountId, executionId: execution.id,
        dispatchToken: execution.dispatchToken, machineId: tag, timeoutMs: 60000 });
    await db.orchestratorExecution.update({ where: { id: execution.id }, data: { status: 'running' } });
    await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'running' } });
    const identity = await api(token, `/v1/orchestrator/executions/${execution.id}/identity`, 'POST', {
        dispatchToken: execution.dispatchToken, machineId: tag, childSessionId: randomUUID(),
        worktreePath: join(privateDir, 'worktree'), branchName: 'fixture-drain', capability: capability.token,
    });
    assert.equal(identity.status, 200);
    const proof = { machineId: tag, dispatchToken: execution.dispatchToken,
        expiredCapability: capability.token };
    await delay(Math.max(0, Date.parse(capability.expiresAt) + 200 - Date.now()));
    const first = await api(token, `/v1/ai-team/executions/${execution.id}/capabilities/recovery-requests`, 'POST', proof);
    assert.equal(first.status, 201);
    assert.equal(first.value.generation, 1);
    const recoveryId = first.value.id as string;
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript(({ authToken, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token: authToken, secret }));
    }, { authToken: token, secret: Buffer.from(keys.secretKey.subarray(0, 32)).toString('base64') });
    const page = await context.newPage();
    await page.goto(`${web}/settings/capability-recoveries`, { waitUntil: 'domcontentloaded' });
    await page.getByText(`generation 1`, { exact: false }).first().waitFor();
    await page.getByText(execution.id, { exact: true }).first().click();
    await page.getByText('Confirm failed drain', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/happy-app-${tag}-generation1-1280.png`, fullPage: true });
    await db.aiCapabilityRecoveryRequest.update({ where: { id: recoveryId },
        data: { requestExpiresAt: new Date(Date.now() - 1000) } });
    const second = await api(token, `/v1/ai-team/executions/${execution.id}/capabilities/recovery-requests`, 'POST', proof);
    assert.equal(second.status, 201);
    assert.equal(second.value.id, recoveryId);
    assert.equal(second.value.generation, 2);
    assert.equal((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recoveryId } })).status, 'pending');
    const confirms: number[] = [];
    await page.route(`**/v1/ai-team/capability-recoveries/${recoveryId}/confirm`, async route => {
        const response = await route.fetch(); confirms.push(response.status()); await route.fulfill({ response });
    });
    await page.getByText('Confirm failed drain', { exact: true }).click();
    await page.getByText('OK', { exact: true }).last().click();
    await page.getByText('Generation or access changed', { exact: false }).waitFor();
    assert.deepEqual(confirms, [409]);
    assert.equal((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recoveryId } })).status, 'pending');
    await page.screenshot({ path: `/tmp/happy-app-${tag}-stale-generation-1280.png`, fullPage: true });
    await page.getByText('Refresh requests', { exact: true }).click();
    await page.getByText('generation 2', { exact: false }).first().waitFor();
    await page.getByText(execution.id, { exact: true }).first().click();
    await page.getByText('Confirm failed drain', { exact: true }).click();
    await page.getByText('OK', { exact: true }).last().click();
    for (let attempt = 0; attempt < 20 && confirms.length < 2; attempt++) await delay(100);
    assert.deepEqual(confirms, [409, 200]);
    assert.equal((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recoveryId } })).status, 'confirmed');
    const audit = await api(token, `/v1/ai-team/capability-recoveries/${recoveryId}/audit`);
    assert.equal(audit.status, 200);
    assert.ok(audit.value.audit.some((entry: { generation: number; action: string }) =>
        entry.generation === 2 && entry.action === 'confirmed'));
    await page.setViewportSize({ width: 390, height: 850 });
    await page.screenshot({ path: `/tmp/happy-app-${tag}-confirmed-390.png`, fullPage: true });
    console.log(JSON.stringify({ tag, accountId, executionId: execution.id, recoveryId,
        naturalStandardCapabilityExpiry: true, requestDeadlineFixtureShortened: true,
        generations: [1, 2], browserConfirmStatuses: confirms, auditConfirmedGeneration: 2,
        screenshots: [`/tmp/happy-app-${tag}-generation1-1280.png`,
            `/tmp/happy-app-${tag}-stale-generation-1280.png`, `/tmp/happy-app-${tag}-confirmed-390.png`] }));
} finally {
    if (browser) await browser.close();
    if (accountId) {
        const row = await db.account.findUnique({ where: { id: accountId }, select: { publicKey: true } });
        assert.ok(row && Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(keys.publicKey)) === 0,
            'Account public key mismatch; cleanup refused');
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
        await db.account.delete({ where: { id: accountId } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
        console.log(JSON.stringify({ tag, accountId, publicKeyMatched: true, residualAccounts: 0 }));
    }
    await db.$disconnect();
    rmSync(privateDir, { recursive: true, force: true });
}
