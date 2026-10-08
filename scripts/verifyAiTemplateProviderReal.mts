import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { inventoryTree } from './aiTeamProductionTree.mjs';

// Commander-owned independent public Project -> actual daemon/Codex proof.
// Account review is an explicit test actor, not a physical human identity claim.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'packages/happy-server/package.json'));
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
const { Redis } = require('ioredis');
const entry = process.env.HAPPY_TEST_CLI_ENTRY;
assert.ok(entry && existsSync(entry), 'A fixed isolated current CLI bundle is required');
const bundleHash = createHash('sha256').update(readFileSync(entry)).digest('hex');
const expectedEntry = process.env.HAPPY_TEST_CLI_SHA256;
if (expectedEntry) assert.equal(bundleHash, expectedEntry, 'Explicit current CLI entry differs');
const distHash = inventoryTree(dirname(entry), dirname(entry)).sha256;
if (process.env.HAPPY_TEST_CLI_DIST_SHA256) assert.equal(distHash, process.env.HAPPY_TEST_CLI_DIST_SHA256,
    'Explicit current CLI whole dist differs');
const name = `happy_ai_template_root_${randomBytes(8).toString('hex')}`;
assert.match(name, /^happy_ai_template_root_[0-9a-f]{16}$/);
const configured = new URL(process.env.DATABASE_URL!);
const adminUrl = new URL(configured); adminUrl.pathname = '/postgres';
const url = new URL(configured); url.pathname = `/${name}`;
url.searchParams.set('connection_limit', '2');
adminUrl.searchParams.set('connection_limit', '1');
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const owned = mkdtempSync(join(tmpdir(), 'happy-ai-template-root-')); chmodSync(owned, 0o700);
writeFileSync(join(owned, 'ownership.json'), JSON.stringify({ database: name }), { mode: 0o600 });
console.log(JSON.stringify({ phase: 'owned_template_provider_start', database: name, ownedDirectory: owned }));
let created = false;
let server: ChildProcess | undefined;
let cli: ChildProcess | undefined;
let machines: Array<{ id: string; accountId: string }> = [];
let passed = false;
async function port() {
    const socket = createServer();
    await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
    const number = (socket.address() as { port: number }).port;
    await new Promise<void>(done => socket.close(() => done())); return number;
}
async function stop(child: ChildProcess | undefined) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
}
try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
    const env = { ...process.env, DATABASE_URL: url.toString(), TMPDIR: owned };
    const migrated = spawnSync(join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
        cwd: join(root, 'packages/happy-server'), env, stdio: 'pipe', timeout: 180000 });
    assert.equal(migrated.status, 0, 'Owned migration failed');
    const apiPort = await port(); const metricsPort = await port();
    const base = `http://127.0.0.1:${apiPort}`;
    server = spawn(join(root, 'node_modules/.bin/tsx'), ['--tsconfig', 'tsconfig.json', 'sources/main.ts'], {
        cwd: join(root, 'packages/happy-server'), detached: true,
        env: { ...env, PORT: String(apiPort), METRICS_PORT: String(metricsPort) }, stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 90; i++) {
        try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Owned startup. */ }
        assert.equal(server.exitCode, null, 'Owned API exited before readiness'); await delay(1000);
    }
    assert.equal(ready, true, 'Owned API not ready');
    for (const decision of ['accepted', 'rejected'] as const) {
        let output = '';
        let stderr = '';
        cli = spawn(process.execPath, ['scripts/ai-team-p0-real-e2e.mjs'], {
            cwd: join(root, 'packages/happy-cli'), detached: true,
            env: { ...env, HAPPY_TEST_CLI_ENTRY: entry, HAPPY_TEST_SERVER_URL: base,
                HAPPY_TEST_TEMPLATE_PROPOSAL: '1', HAPPY_TEST_TEMPLATE_REJECT: decision === 'rejected' ? '1' : '0',
                HAPPY_TEST_PROJECT_MCP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
        cli.stdout?.on('data', chunk => { output += chunk.toString(); });
        cli.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-20000); });
        const timer = setTimeout(() => { void stop(cli); }, 180000);
        const exitCode = await new Promise<number | null>(done => cli!.once('exit', done)); clearTimeout(timer);
        if (exitCode !== 0) {
            const failures = await db.orchestratorExecution.findMany({ select: { status: true, errorCode: true, errorMessage: true } });
            console.log(JSON.stringify({ phase: 'owned_template_provider_failure', decision,
                exitCode, failures: failures.map(item => ({ status: item.status, errorCode: item.errorCode,
                    message: item.errorMessage?.replace(/[0-9a-f]{32,}/gi, '[redacted]')
                        .replace(/https?:\/\/\S+/g, '[url]').replace(/\/(?:home|tmp|repo)\S*/g, '[path]').slice(0, 600) })),
                failureClasses: ['template', 'proposal', 'runtime', 'Project', 'MCP', 'timeout', 'identity', 'daemon', 'authentication']
                    .filter(value => `${output}\n${stderr}`.toLowerCase().includes(value.toLowerCase())) }));
        }
        assert.equal(exitCode, 0, 'Actual daemon/Codex template run failed; raw provider logs withheld');
        const evidence = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
            .find(item => item.result === 'ACTUAL_CODEX_EXECUTION_TEMPLATE_PROPOSAL_REVIEWED');
        assert.ok(evidence && evidence.decision === decision && evidence.sourceBound && evidence.pendingBeforeReview);
        const execution = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: evidence.executionId }, include: { task: true } });
        const proposal = await db.aiAgentTemplateProposal.findUniqueOrThrow({ where: { id: evidence.proposalId } });
        assert.equal(execution.status, 'completed'); assert.equal(execution.task.status, 'completed');
        assert.ok(execution.pid && execution.childSessionId && execution.worktreePath && execution.branchName);
        assert.equal(await db.orchestratorExecution.count({ where: { taskId: execution.taskId } }), 1);
        assert.equal(proposal.sourceExecutionId, execution.id); assert.equal(proposal.sourceAgentId, execution.task.assignedAgentId);
        assert.equal(proposal.status, decision);
        const template = await db.aiAgentTemplate.findUniqueOrThrow({ where: { id: proposal.templateId } });
        assert.equal(template.currentVersion, decision === 'accepted' ? 2 : 1);
        assert.equal(await db.aiAgentTemplateVersion.count({ where: { templateId: template.id } }), decision === 'accepted' ? 2 : 1);
        const home = output.split('\n').find(line => line.startsWith('P0_TEST_HOME='))?.slice('P0_TEST_HOME='.length);
        assert.ok(home && home.startsWith(`${owned}/happy-p0-cli-real-`) && !existsSync(join(home, 'access.key')));
        const privateHome = join(home, 'orchestrator-codex', createHash('sha256').update(execution.taskId).digest('hex'));
        assert.equal(existsSync(join(privateHome, 'auth.json')), false);
        const sessions = readdirSync(join(privateHome, 'sessions'), { recursive: true }).filter(value => String(value).endsWith('.jsonl'));
        assert.equal(sessions.length, 1);
        const calls = readFileSync(join(privateHome, 'sessions', String(sessions[0])), 'utf8').split('\n')
            .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
            .filter(item => item.type === 'response_item' && item.payload?.type === 'custom_tool_call'
                && item.payload.input?.includes('tools.mcp__happy_template__ai_template_propose('));
        assert.equal(calls.length, 1, 'Real model session did not invoke the constrained tool exactly once');
        console.log(JSON.stringify({ result: 'ROOT_REAL_CODEX_SCOPED_TEMPLATE_REVIEW_OK', decision,
            executionId: execution.id, proposalId: proposal.id, modelToolCalls: calls.length,
            realPidPersisted: true, attempts: 1, publishedVersion: template.currentVersion,
            projectMcpProbeBlocked: true, copiedAuthRemoved: true, humanIdentityVerified: false }));
    }
    assert.equal(createHash('sha256').update(readFileSync(entry)).digest('hex'), bundleHash, 'CLI bundle drifted during acceptance');
    assert.equal(inventoryTree(dirname(entry), dirname(entry)).sha256, distHash, 'CLI dist chunks drifted during acceptance');
    passed = true;
} finally {
    if (created) machines = await db.machine.findMany({ select: { id: true, accountId: true } });
    await stop(cli); await stop(server); await db.$disconnect();
    const redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 1000 });
    let redisCleanupError: unknown;
    try {
        if (redis.status !== 'ready') await new Promise<void>((done, reject) => {
            const timeout = setTimeout(() => reject(new Error('Owned Redis cleanup connection not ready')), 3000);
            redis.once('ready', () => { clearTimeout(timeout); done(); });
            redis.once('error', (error: Error) => { clearTimeout(timeout); reject(error); });
        });
        const suffixes = [...readFileSync(join(root, 'packages/happy-cli/src/api/apiMachine.ts'), 'utf8').matchAll(/registerHandler\('([^']+)'/g)].map(match => match[1]);
        for (const machine of machines) for (const suffix of suffixes) {
            const method = `${machine.id}:${suffix}`;
            const hash = createHash('sha256').update(`${machine.accountId}\0${method}`).digest('hex');
            const key = `happy:rpc:route:v1:${hash}`; const route = await redis.get(key);
            if (route) { const row = JSON.parse(route); assert.equal(row.accountId, machine.accountId); assert.equal(row.method, method); }
            await redis.del(key, `happy:rpc:epoch:v1:${hash}`);
        }
    } catch (error) {
        redisCleanupError = error;
        writeFileSync(join(owned, 'ownership.json'), JSON.stringify({ database: name, machines,
            exactRedisCleanupPending: true }), { mode: 0o600 });
    } finally { redis.disconnect(); }
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    const residual = await admin.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT count(*)::bigint AS count FROM pg_database WHERE datname=$1', name);
    assert.equal(Number(residual[0].count), 0); await admin.$disconnect();
    if (!redisCleanupError) rmSync(owned, { recursive: true, force: true });
    console.log(JSON.stringify({ result: 'ROOT_TEMPLATE_PROVIDER_CLEANUP', databaseResidual: 0,
        ownedHomeRemoved: !existsSync(owned), exactRedisCleanupPending: Boolean(redisCleanupError),
        fixedCliBundleSha256: bundleHash, passed }));
    if (redisCleanupError) throw redisCleanupError;
}
