import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import nacl from 'tweetnacl';
import { PrismaClient } from '@prisma/client';
import { provisionDispatchCapability } from '../../happy-server/sources/app/ai/workspaceAuth';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
const tag = `APPRECOVERYUI-${Date.now()}`;
const base = 'http://127.0.0.1:43105';
const web = 'http://localhost:43106';
const operator = generateKeyPairSync('ed25519');
const db = new PrismaClient();
const pair = nacl.sign.keyPair();
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64');
let apiServer: ChildProcess | undefined;
let expo: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let accountId: string | undefined;
let runId: string | undefined;
let executionId: string | undefined;
let token: string | undefined;

async function waitHealth(url: string) {
    for (let index = 0; index < 90; index++) {
        try { if ((await fetch(url)).ok) return; } catch { /* Starting. */ }
        await delay(1000);
    }
    throw new Error(`${url} did not start`);
}
async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/v1${path}`, { method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => null) };
}
try {
    apiServer = spawn('npx', ['tsx', './sources/main.ts'], { cwd: '../happy-server',
        env: { ...process.env, PORT: '43105', METRICS_PORT: '43107',
            AI_WEBAUTHN_RP_ID: 'localhost', AI_WEBAUTHN_ORIGIN: web,
            AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI: operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
        stdio: 'ignore', detached: true });
    expo = spawn('npx', ['expo', 'start', '--web', '--port', '43106', '--host', 'localhost'], {
        cwd: '.', env: { ...process.env, EXPO_PUBLIC_HAPPY_SERVER_URL: base, EXPO_NO_TELEMETRY: '1' },
        stdio: 'ignore', detached: true });
    await Promise.all([waitHealth(`${base}/health`), waitHealth(`${web}/settings/human-credentials`)]);
    const challenge = nacl.randomBytes(32);
    const auth = await fetch(`${base}/v1/auth`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: b64(pair.publicKey), challenge: b64(challenge),
            signature: b64(nacl.sign.detached(challenge, pair.secretKey)) }) });
    assert.equal(auth.status, 200);
    token = (await auth.json()).token;
    accountId = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString()).sub;
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ token, secret }: { token: string; secret: string }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token, secret: b64(pair.secretKey.subarray(0, 32)) });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${web}/settings/human-credentials`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Add device', { exact: true }).click();
    await page.getByText('Awaiting independent review', { exact: true }).waitFor();
    const credential = (await api('/ai-team/human-credentials')).data.items[0];
    assert.equal(credential.status, 'pending');
    const approval = { accountId, credentialId: credential.id, approvalNonce: randomUUID(),
        actorLabel: 'isolated_app_test_operator',
        evidenceHash: createHash('sha256').update('virtual-authenticator fixture; no human identity verified').digest('hex'),
        expiresAt: new Date(Date.now() + 120_000).toISOString() };
    const signature = sign(null, Buffer.from(JSON.stringify(approval)), operator.privateKey).toString('base64url');
    assert.equal((await api(`/ai-team/human-credentials/${credential.id}/trust`, 'POST', { approval, signature })).status, 200);
    await page.getByText('Refresh status', { exact: true }).click();
    await page.getByText('Verified', { exact: true }).waitFor();
    const run = await db.orchestratorRun.create({ data: { accountId, title: tag,
        status: 'running', tasks: { create: { seq: 1, taskKey: 'human', provider: 'codex', prompt: '',
            permissionMode: 'read_only', status: 'dispatching', targetMachineId: tag } } }, include: { tasks: true } });
    runId = run.id;
    const execution = await db.orchestratorExecution.create({ data: { runId, taskId: run.tasks[0].id,
        machineId: tag, provider: 'codex', status: 'dispatching', dispatchToken: randomUUID() } });
    executionId = execution.id;
    const capability = await provisionDispatchCapability({ accountId, executionId,
        machineId: tag, dispatchToken: execution.dispatchToken, timeoutMs: 60_000 });
    await db.orchestratorExecution.update({ where: { id: executionId }, data: { status: 'running' } });
    await db.orchestratorTask.update({ where: { id: run.tasks[0].id }, data: { status: 'running' } });
    assert.equal((await api(`/orchestrator/executions/${executionId}/identity`, 'POST', {
        machineId: tag, dispatchToken: execution.dispatchToken, childSessionId: randomUUID(),
        branchName: 'owned-recovery', worktreePath: `/tmp/${tag}/${executionId}`,
        capability: capability.token })).status, 200);
    await delay(Math.max(0, Date.parse(capability.expiresAt) + 200 - Date.now()));
    const requested = await api(`/ai-team/executions/${executionId}/capabilities/recovery-requests`, 'POST', {
        machineId: tag, dispatchToken: execution.dispatchToken, expiredCapability: capability.token });
    assert.equal(requested.status, 201);
    const recoveryId = requested.data.id;
    await page.goto(`${web}/settings/capability-recoveries`, { waitUntil: 'domcontentloaded' });
    await page.getByText(executionId, { exact: true }).first().click();
    await page.getByText('Confirm failed drain', { exact: true }).click();
    await page.getByText('Confirm failed execution drain?', { exact: true }).waitFor();
    await page.getByText('OK', { exact: true }).click();
    await page.getByText(/human_verified/).waitFor({ timeout: 30000 });
    const confirmed = await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recoveryId }, include: { audit: true } });
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.generation, 1);
    assert.equal(confirmed.audit.filter((entry) => entry.action.startsWith('human_verified:')).length, 1);
    const screenshot = `/tmp/${tag}-confirmed-390.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await db.aiCapabilityRecoveryRequest.update({ where: { id: recoveryId },
        data: { requestExpiresAt: new Date(Date.now() - 2000) } });
    const second = await api(`/ai-team/executions/${executionId}/capabilities/recovery-requests`, 'POST', {
        machineId: tag, dispatchToken: execution.dispatchToken, expiredCapability: capability.token });
    assert.equal(second.status, 201);
    assert.equal(second.data.id, recoveryId);
    assert.equal(second.data.generation, 2);
    assert.equal((await api(`/ai-team/capability-recoveries/${recoveryId}/confirmation/options`, 'POST', {
        generation: 1 })).status, 409);
    await page.getByText('Refresh requests', { exact: true }).click();
    await page.getByText(executionId, { exact: true }).first().click();
    await page.getByText('Confirm failed drain', { exact: true }).click();
    await page.getByText('Confirm failed execution drain?', { exact: true }).waitFor();
    await page.getByText('OK', { exact: true }).click();
    for (let index = 0; index < 30; index++) {
        if ((await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recoveryId } })).status === 'confirmed') break;
        await delay(100);
    }
    const reconfirmed = await db.aiCapabilityRecoveryRequest.findUniqueOrThrow({ where: { id: recoveryId }, include: { audit: true } });
    assert.equal(reconfirmed.status, 'confirmed');
    assert.equal(reconfirmed.generation, 2);
    assert.equal(reconfirmed.audit.filter((entry) => entry.action.startsWith('human_verified:')).length, 2);
    const secondScreenshot = `/tmp/${tag}-generation2-confirmed-390.png`;
    await page.screenshot({ path: secondScreenshot, fullPage: true });
    console.log(JSON.stringify({ tag, accountId, recoveryId, generations: [1, 2], status: reconfirmed.status,
        humanVerifiedAudit: 2, screenshot, secondScreenshot, secondGenerationDeadline: 'fixture_expired',
        oldGenerationOptionsStatus: 409, operator: 'independent_fixture', authenticator: 'virtual',
        physicalHumanVerified: false }));
} finally {
    await browser?.close();
    for (const child of [expo, apiServer]) if (child?.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Exited. */ }
    }
    await delay(500);
    if (accountId) {
        const row = await db.account.findUnique({ where: { id: accountId }, select: { publicKey: true } });
        assert.ok(row);
        assert.equal(Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(pair.publicKey)), 0);
        if (executionId) await db.aiExecutionCapability.deleteMany({ where: { executionId, accountId } });
        if (runId) await db.orchestratorRun.delete({ where: { id: runId } });
        await db.aiWebAuthnChallenge.deleteMany({ where: { accountId } });
        await db.aiHumanCredential.deleteMany({ where: { accountId } });
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
        await db.userKVStore.deleteMany({ where: { accountId } });
        await db.account.delete({ where: { id: accountId } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
        console.log(JSON.stringify({ tag, cleanup: 'public_key_verified', residualAccounts: 0 }));
    }
    await db.$disconnect();
}
