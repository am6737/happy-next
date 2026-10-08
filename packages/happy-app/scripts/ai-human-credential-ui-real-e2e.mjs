import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl';

const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
const tag = `APPWEBAUTHN-${Date.now()}`;
const apiBase = 'http://127.0.0.1:43105';
const webBase = 'http://localhost:43106';
const db = new PrismaClient();
const pair = nacl.sign.keyPair();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
let accountId;
let browser;

try {
    const challenge = nacl.randomBytes(32);
    const authResponse = await fetch(`${apiBase}/v1/auth`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: b64(pair.publicKey), challenge: b64(challenge),
            signature: b64(nacl.sign.detached(challenge, pair.secretKey)) }) });
    assert.equal(authResponse.status, 200);
    const { token } = await authResponse.json();
    accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM
            ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome',
        args: ['--no-sandbox'] });
    const width = Number(process.env.HAPPY_TEST_VIEWPORT_WIDTH ?? 390);
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.addInitScript(({ token, secret }) => {
        localStorage.setItem('auth_credentials', JSON.stringify({ token, secret }));
    }, { token, secret: b64(pair.secretKey.subarray(0, 32)) });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    await page.goto(`${webBase}/settings/human-credentials`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Add device', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByText('Add device', { exact: true }).click();
    await page.getByText('Awaiting independent review', { exact: true }).waitFor({ timeout: 30000 });
    const credentialsResponse = await fetch(`${apiBase}/v1/ai-team/human-credentials`, {
        headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(credentialsResponse.status, 200);
    const credentials = (await credentialsResponse.json()).items;
    assert.equal(credentials.length, 1);
    assert.equal(credentials[0].status, 'pending');
    const screenshot = `/tmp/${tag}-pending-${width}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.goto(`${webBase}/settings/capability-recoveries`, { waitUntil: 'domcontentloaded' });
    await page.getByText('No verified device is available for recovery confirmation.', { exact: true }).waitFor();
    const blockedScreenshot = `/tmp/${tag}-recovery-blocked-${width}.png`;
    await page.screenshot({ path: blockedScreenshot, fullPage: true });
    await page.goto(`${webBase}/settings/human-credentials`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Awaiting independent review', { exact: true }).waitFor();
    await page.getByText('Revoke', { exact: true }).click();
    await page.getByText('Revoke this device?', { exact: true }).waitFor();
    await page.getByText('OK', { exact: true }).click();
    await page.getByText('Revoked', { exact: true }).waitFor();
    const finalState = await fetch(`${apiBase}/v1/ai-team/human-credentials`, {
        headers: { authorization: `Bearer ${token}` },
    });
    assert.equal((await finalState.json()).items[0].status, 'revoked');
    console.log(JSON.stringify({ tag, accountId, result: 'pass', virtualAuthenticator: true,
        humanIdentityVerified: false, screenshot, blockedScreenshot }));
} finally {
    await browser?.close();
    if (accountId) {
        const row = await db.account.findUnique({ where: { id: accountId }, select: { publicKey: true } });
        assert.ok(row);
        assert.equal(Buffer.compare(Buffer.from(row.publicKey, 'hex'), Buffer.from(pair.publicKey)), 0);
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
