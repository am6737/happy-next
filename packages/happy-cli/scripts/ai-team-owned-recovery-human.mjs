import assert from 'node:assert/strict';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

// Test-only CDP authenticator. It proves the protocol, not human presence.
export async function createOwnedRecoveryHuman({ base, accountId, token, keyFile }) {
  const address = new URL(base);
  assert.ok(['127.0.0.1', 'localhost'].includes(address.hostname));
  const keyStat = lstatSync(keyFile);
  assert.ok(keyStat.isFile() && (keyStat.mode & 0o077) === 0);
  const operatorKey = createPrivateKey(readFileSync(keyFile));
  const origin = new URL(base); origin.hostname = 'localhost';
  const modulePath = process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
    ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs';
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.HAPPY_TEST_CHROMIUM
    ?? chromium.executablePath(), args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
    const post = (path, body) => fetch(`${base}/v1${path}`, { method: 'POST',
      signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`,
        'content-type': 'application/json' }, body: JSON.stringify(body) });
    const credentialResponse = (options, registration) => page.evaluate(async ({ options, registration }) => {
      const decode = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')),
        (char) => char.charCodeAt(0));
      const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      options.challenge = decode(options.challenge);
      for (const key of ['allowCredentials', 'excludeCredentials']) {
        if (options[key]) options[key] = options[key].map((item) => ({ ...item, id: decode(item.id) }));
      }
      if (registration) options.user.id = decode(options.user.id);
      const credential = registration
        ? await navigator.credentials.create({ publicKey: options })
        : await navigator.credentials.get({ publicKey: options });
      const response = credential.response;
      return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: registration ? { clientDataJSON: encode(response.clientDataJSON),
          attestationObject: encode(response.attestationObject), transports: response.getTransports() }
          : { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData),
            signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null } };
    }, { options, registration });
    const started = await post('/ai-team/human-credentials/registration/options', {});
    assert.equal(started.status, 201);
    const registration = await started.json();
    const response = await credentialResponse(registration.options, true);
    const verified = await post('/ai-team/human-credentials/registration/verify', {
      challengeId: registration.challengeId, response });
    assert.equal(verified.status, 201);
    const credential = await verified.json();
    assert.equal(credential.status, 'pending');
    const approval = { accountId, credentialId: credential.credentialId,
      approvalNonce: randomUUID(), actorLabel: 'owned_cli_virtual_authenticator',
      evidenceHash: createHash('sha256').update('Owned virtual authenticator, no human').digest('hex'),
      expiresAt: new Date(Date.now() + 120_000).toISOString() };
    const signature = sign(null, Buffer.from(JSON.stringify(approval)), operatorKey).toString('base64url');
    const trusted = await post(`/ai-team/human-credentials/${credential.credentialId}/trust`, { approval, signature });
    assert.equal(trusted.status, 200);
    return { assertion: async (recoveryId, generation) => {
      const options = await post(`/ai-team/capability-recoveries/${recoveryId}/confirmation/options`, { generation });
      assert.equal(options.status, 201);
      const challenge = await options.json();
      return { confirmation: 'drain_failed_execution', generation,
        challengeId: challenge.challengeId,
        assertion: await credentialResponse(challenge.options, false) };
    }, close: () => browser.close() };
  } catch (error) { await browser.close(); throw error; }
}
