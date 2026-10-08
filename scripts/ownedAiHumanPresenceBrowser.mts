import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';

// Real Chromium WebAuthn protocol with a CDP virtual authenticator. This is
// deliberately not evidence of a physical authenticator or a human being.
// The test operator key is independent of account/daemon authentication.
export async function createOwnedAiHumanBrowser(input: { base: string; accountId: string;
    post: (path: string, body: unknown, actor?: string) => Promise<Response> }) {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(input.base).hostname));
    const origin = new URL(input.base); origin.hostname = 'localhost';
    const envNames = ['AI_WEBAUTHN_RP_ID', 'AI_WEBAUTHN_ORIGIN', 'AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI'];
    const oldEnv = envNames.map(name => process.env[name]);
    const operator = generateKeyPairSync('ed25519');
    process.env.AI_WEBAUTHN_RP_ID = 'localhost';
    process.env.AI_WEBAUTHN_ORIGIN = origin.origin;
    process.env.AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const modulePath = process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
        ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs';
    const { chromium } = await import(modulePath);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HAPPY_TEST_CHROMIUM
        ?? '/home/coder/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext(); const page = await context.newPage();
    const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true } });
    // tsx/esbuild preserves function names with this helper when serializing
    // evaluate callbacks; install it only on the owned protocol fixture page.
    await page.addInitScript({ content: 'globalThis.__name = function(fn) { return fn; };' });
    await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
    const alternate = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>Owned alternate WebAuthn origin</title>');
    });
    await new Promise<void>(resolve => alternate.listen(0, '127.0.0.1', resolve));
    const alternatePort = (alternate.address() as { port: number }).port;
    const credentialResponse = async (options: any, registration: boolean) => page.evaluate(async ({ options, registration }: any) => {
        const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')),
            char => char.charCodeAt(0));
        const encode = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        options.challenge = decode(options.challenge);
        for (const key of ['allowCredentials', 'excludeCredentials']) {
            if (options[key]) options[key] = options[key].map((item: any) => ({ ...item, id: decode(item.id) }));
        }
        if (registration) options.user.id = decode(options.user.id);
        const credential: any = registration
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
    const restore = async () => {
        await browser.close();
        await new Promise<void>(resolve => alternate.close(() => resolve()));
        envNames.forEach((name, index) => {
            if (oldEnv[index] === undefined) delete process.env[name]; else process.env[name] = oldEnv[index];
        });
    };
    try {
        const started = await input.post('/ai-team/human-credentials/registration/options', {});
        assert.equal(started.status, 201); const registration = await started.json() as any;
        const response = await credentialResponse(registration.options, true);
        const verified = await input.post('/ai-team/human-credentials/registration/verify', {
            challengeId: registration.challengeId, response });
        assert.equal(verified.status, 201); const credential = await verified.json() as any;
        assert.equal(credential.status, 'pending');
        const approval = { accountId: input.accountId, credentialId: credential.credentialId,
            approvalNonce: randomUUID(), actorLabel: 'owned_independent_test_operator',
            evidenceHash: createHash('sha256').update('Owned virtual authenticator fixture, not real human').digest('hex'),
            expiresAt: new Date(Date.now() + 120000).toISOString() };
        const signature = sign(null, Buffer.from(JSON.stringify(approval)), operator.privateKey).toString('base64url');
        return { credentialId: credential.credentialId, registration, registrationResponse: response, approval, signature,
            trust: () => input.post(`/ai-team/human-credentials/${credential.credentialId}/trust`, { approval, signature }),
            assertion: async (recoveryId: string, generation: number, wrongOrigin = false) => {
                const options = await input.post(`/ai-team/capability-recoveries/${recoveryId}/confirmation/options`, { generation });
                assert.equal(options.status, 201); const value = await options.json() as any;
                const browserOrigin = new URL(origin.origin);
                if (wrongOrigin) browserOrigin.port = String(alternatePort);
                await page.goto(browserOrigin.origin, { waitUntil: 'domcontentloaded' });
                return { confirmation: 'drain_failed_execution', generation, challengeId: value.challengeId,
                    assertion: await credentialResponse(value.options, false) };
            },
            setUserVerified: (isUserVerified: boolean) => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified }),
            close: restore };
    } catch (error) { await restore(); throw error; }
}
