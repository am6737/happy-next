import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiSkillRoutes } from '../packages/happy-server/sources/app/api/routes/aiSkillRoutes';
import { installSkillBundle } from '../packages/happy-cli/src/orchestrator/skillBundle';
import { verifyAiSkillBundle } from './verifyAiSkillBundle.mjs';

const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID(); const ownedAccounts: string[] = [];
const local = mkdtempSync(join(tmpdir(), 'happy-skills-http-acceptance-'));
app.decorate('authenticate', async (request: any, reply: any) => {
    const account = request.headers['x-owned-fixture-account'] ?? request.headers.authorization?.replace(/^Bearer /, '');
    if (!ownedAccounts.includes(account)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = account;
});
const digest = (content: Buffer) => createHash('sha256').update(content).digest('hex');
try {
    for (const suffix of ['a', 'b']) ownedAccounts.push((await db.account.create({ data: { publicKey: `skills-http-${tag}-${suffix}` } })).id);
    const [accountId, otherId] = ownedAccounts;
    aiSkillRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = async (path: string, body?: unknown, account = accountId) => {
        const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json', 'x-owned-fixture-account': account },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
        return { status: response.status, body: await response.json() as any };
    };
    const create = await request('/v1/ai-team/skills', { name: `Owned-${tag}` });
    assert.equal(create.status, 201); const skillId = create.body.id;
    const prefix = `/v1/ai-team/skills/${skillId}`;
    const sourceFiles = [{ path: 'SKILL.md', bytes: Buffer.from('# Owned skill\nRead references/rules.md.\n') },
        { path: 'references/rules.md', bytes: Buffer.from('Exact approved rules\n') }];
    const files = sourceFiles.map(({ path, bytes }) => ({ path, contentBase64: bytes.toString('base64') }));
    const upload = await request(`${prefix}/versions`, { files });
    assert.equal(upload.status, 201); assert.equal(upload.body.version, 1);
    const repeats = await Promise.all(Array.from({ length: 8 }, () => request(`${prefix}/versions`, { files })));
    assert.ok(repeats.every((result) => [200, 503].includes(result.status)));
    assert.equal(await db.aiSkillVersion.count({ where: { skillId } }), 1);
    assert.equal((await request(`${prefix}/versions`, { files }, otherId)).status, 404);
    assert.equal((await request(`${prefix}/versions/1/publish`, { confirmed: false })).status, 400);
    assert.equal((await request(`${prefix}/versions/1/publish`, { confirmed: true }, otherId)).status, 404);
    assert.equal((await request(`${prefix}/versions/1/publish`, { confirmed: true })).status, 200);
    assert.equal((await request(`${prefix}/versions`, { files: [{ path: '../SKILL.md', contentBase64: 'QQ==' }] })).status, 400);
    const v2 = await request(`${prefix}/versions`, { files: [{ path: 'SKILL.md', contentBase64: Buffer.from('# New version\n').toString('base64') }] });
    assert.equal(v2.status, 201); assert.equal(v2.body.version, 2);
    assert.equal((await request(`${prefix}/rollback`, { version: 2, confirmed: true })).status, 409);
    const stored = await db.aiSkillVersion.findUniqueOrThrow({ where: { skillId_version: { skillId, version: 1 } }, include: { files: true } });
    assert.equal(stored.contentHash, upload.body.contentHash);
    for (const file of sourceFiles) assert.ok(Buffer.from(stored.files.find((item) => item.path === file.path)!.content).equals(file.bytes));
    // Construct a fixture-owned frozen task snapshot to exercise the actual
    // execution-bound download API. This does not claim task creation UI E2E.
    const run = await db.orchestratorRun.create({ data: { accountId, title: tag, status: 'running', tasks: { create: {
        seq: 1, taskKey: 'owned', provider: 'codex', prompt: '', status: 'running',
    } } }, include: { tasks: true } });
    const task = run.tasks[0]; const dispatchToken = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id, taskId: task.id,
        machineId: tag, provider: 'codex', dispatchToken, status: 'running' } });
    await db.aiTaskSkillSnapshot.create({ data: { taskId: task.id, skillId, version: 1, contentHash: stored.contentHash } });
    assert.equal((await request(`${prefix}/versions/2/publish`, { confirmed: true })).status, 200);
    const downloadPath = `/v1/ai-team/tasks/${task.id}/skills/download`;
    const downloadIdentity = { executionId: execution.id, dispatchToken };
    assert.equal((await request(downloadPath, downloadIdentity, otherId)).status, 403);
    assert.equal((await request(downloadPath, { ...downloadIdentity, dispatchToken: randomUUID() })).status, 403);
    const downloaded = await request(downloadPath, downloadIdentity);
    assert.equal(downloaded.status, 200); assert.equal(downloaded.body.items.length, 1);
    const bundle = downloaded.body.items[0]; assert.equal(bundle.version, 1);
    assert.equal(bundle.hash, stored.contentHash);
    const installed = installSkillBundle(local, bundle, { skillId, version: 1, hash: stored.contentHash });
    const manifest = { skillId, version: 1, files: sourceFiles.map(({ path, bytes }) => ({ path, sha256: digest(bytes), sizeBytes: bytes.length })) };
    const verified = verifyAiSkillBundle(installed, manifest);
    assert.equal(verified.files, 2);
    // Exercise the real CLI ApiClient in a separate process with its own
    // configuration paths; await asynchronously so loopback HTTP can respond.
    const inputPath = join(local, 'owned-client-input.json');
    writeFileSync(inputPath, JSON.stringify({ accountId, taskId: task.id, executionId: execution.id,
        dispatchToken, manifest, expectedHash: stored.contentHash, installRoot: join(local, 'client-installed') }), { mode: 0o600 });
    const rootPath = fileURLToPath(new URL('../', import.meta.url));
    const clientCheck = await promisify(execFile)(join(rootPath, 'node_modules/.bin/tsx'), [
        '--tsconfig', join(rootPath, 'packages/happy-cli/tsconfig.json'),
        join(rootPath, 'scripts/verifyAiSkillApiClientReal.mts'), inputPath,
    ], { env: { ...process.env, HAPPY_SERVER_URL: base, HAPPY_HOME_DIR: join(local, 'client-home') },
        timeout: 30_000, maxBuffer: 64_000 });
    assert.ok(clientCheck.stdout.includes('REAL_CLI_API_SKILL_DOWNLOAD_AND_INSTALL_BYTES_OK'));
    console.log('REAL_CLI_API_SKILL_DOWNLOAD_AND_INSTALL_BYTES_OK');
    assert.equal((await request(`${prefix}/rollback`, { version: 1, confirmed: true })).status, 200);
    console.log('REAL_DB_HTTP_SKILLS_IMMUTABLE_PUBLISH_ROLLBACK_TOKEN_ISOLATION_AND_INSTALL_BYTES_OK');
    const invalid = await request(`${prefix}/versions`, { files: [{ path: 'SKILL.md', contentBase64: Buffer.from([0xc3, 0x28]).toString('base64') }] });
    console.log(`REAL_DB_HTTP_SKILLS_INVALID_UTF8 status=${invalid.status}`);
    assert.equal(invalid.status, 400, 'Invalid UTF-8 SKILL.md was accepted as an immutable skill version');
} finally {
    await app.close();
    for (const accountId of ownedAccounts) {
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.aiSkill.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId, publicKey: { startsWith: `skills-http-${tag}-` } } });
    }
    assert.equal(await db.account.count({ where: { id: { in: ownedAccounts } } }), 0);
    rmSync(local, { recursive: true, force: true }); await db.$disconnect(); redis.disconnect();
}
