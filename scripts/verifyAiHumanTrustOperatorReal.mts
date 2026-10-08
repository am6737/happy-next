import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiWorkspaceRoutes } from '../packages/happy-server/sources/app/api/routes/aiWorkspaceRoutes';

const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `trust-operator-root-${randomUUID()}`;
const owned = mkdtempSync(join(tmpdir(), 'happy-trust-operator-root-')); chmodSync(owned, 0o700);
const keyFile = join(owned, 'operator.pem'); const approvalFile = join(owned, 'approval.json');
const outputFile = join(owned, 'signed.json');
const oldKey = process.env.AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI;
const accounts: string[] = [];
const signer = new URL('./aiHumanTrustSign.mjs', import.meta.url);
function invoke(key = keyFile, out = outputFile) {
    return spawnSync(process.execPath, [signer.pathname, '--private-key', key,
        '--approval', approvalFile, '--out', out], { encoding: 'utf8', timeout: 10_000 });
}
app.decorate('authenticate', async (request: any, reply: any) => {
    const actor = request.headers['x-fixture-account'];
    if (!accounts.includes(actor)) return reply.code(401).send({ error: 'owned_fixture' });
    request.userId = actor;
});
try {
    const operator = generateKeyPairSync('ed25519');
    writeFileSync(keyFile, operator.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    process.env.AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI = operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    for (const index of [0, 1]) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${index}` } })).id);
    // Pending credential is an owned database fixture: this verifies operator
    // signing/HTTP/DB only, not WebAuthn registration or human identity.
    const credential = await db.aiHumanCredential.create({ data: { accountId: accounts[0],
        credentialId: tag, publicKey: Buffer.from('fixture'), deviceType: 'singleDevice' } });
    const approval = { expiresAt: new Date(Date.now() + 120_000).toISOString(),
        evidenceHash: createHash('sha256').update('Owned signing fixture; no human verified').digest('hex'),
        actorLabel: 'owned_offline_test_operator', approvalNonce: randomUUID(),
        credentialId: credential.id, accountId: accounts[0] };
    const save = (value: unknown) => writeFileSync(approvalFile, JSON.stringify(value), { mode: 0o600 });
    for (const name of ['accountId', 'accou\\u006EtId']) {
        writeFileSync(approvalFile, `{"${name}":"wrong_review_account",${JSON.stringify(approval).slice(1)}`, { mode: 0o600 });
        assert.equal(invoke().status, 1, 'Original JSON duplicate member was signed');
        assert.equal(invoke().stdout, '', 'Rejected approval leaked output');
    }
    const invalidUtf8 = Buffer.from(JSON.stringify(approval));
    const actorOffset = invalidUtf8.indexOf(Buffer.from(approval.actorLabel));
    assert.ok(actorOffset >= 0); invalidUtf8[actorOffset] = 0xff;
    writeFileSync(approvalFile, invalidUtf8, { mode: 0o600 });
    assert.equal(invoke().status, 1, 'Lossy UTF-8 approval was signed');
    save({ ...approval, extra: true }); assert.equal(invoke().status, 1);
    save({ ...approval, expiresAt: new Date(Date.now() - 1_000).toISOString() }); assert.equal(invoke().status, 1);
    save({ ...approval, expiresAt: new Date(Date.now() + 600_000).toISOString() }); assert.equal(invoke().status, 1);
    save(approval); chmodSync(keyFile, 0o644); assert.equal(invoke().status, 1); chmodSync(keyFile, 0o600);
    const linked = join(owned, 'linked.pem'); symlinkSync(keyFile, linked); assert.equal(invoke(linked).status, 1);
    const success = invoke(); assert.equal(success.status, 0);
    assert.equal(success.stdout.trim(), 'OFFLINE_HUMAN_TRUST_APPROVAL_SIGNED');
    assert.equal(statSync(outputFile).mode & 0o777, 0o600);
    const body = JSON.parse(readFileSync(outputFile, 'utf8'));
    const previous = readFileSync(outputFile); assert.equal(invoke().status, 1);
    assert.deepEqual(readFileSync(outputFile), previous, 'Signer overwrote existing approval');
    aiWorkspaceRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (value: unknown, actor = accounts[0]) => fetch(`${base}/v1/ai-team/human-credentials/${credential.id}/trust`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-account': actor },
        body: JSON.stringify(value), signal: AbortSignal.timeout(15_000) });
    assert.equal((await post(body, accounts[1])).status, 409);
    assert.equal((await post({ ...body, approval: { ...body.approval, evidenceHash: '0'.repeat(64) } })).status, 409);
    assert.equal((await db.aiHumanCredential.findUniqueOrThrow({ where: { id: credential.id } })).status, 'pending');
    assert.equal((await post(body)).status, 200);
    assert.equal((await post(body)).status, 409);
    assert.equal((await db.aiHumanCredential.findUniqueOrThrow({ where: { id: credential.id } })).status, 'trusted');
    assert.equal(await db.aiHumanCredentialTrustAudit.count({ where: { accountId: accounts[0], approvalNonce: approval.approvalNonce } }), 1);
    console.log('OFFLINE_OPERATOR_SIGNER_REAL_HTTP_DB_TRUST_CAS_REPLAY_TAMPER_PRIVATE_FILE_OK humanIdentityVerified=false');
} finally {
    await app.close();
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    await db.$disconnect(); redis.disconnect();
    if (oldKey === undefined) delete process.env.AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI;
    else process.env.AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI = oldKey;
    rmSync(owned, { recursive: true, force: true });
    console.log('OFFLINE_OPERATOR_OWNED_FIXTURE_CLEANUP residual=0');
}
