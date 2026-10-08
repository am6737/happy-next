import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inventoryTree } from './aiTeamProductionTree.mjs';
import { verifyPublishedNpmTree, verifyOldServerTrackedTree } from './aiTeamOldComponentIdentity.mjs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { resolveProductionRuntime, productionModule } from './aiTeamProductionRuntime.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function classifyNotFoundResponse(method: string, path: string, status: number, body: Buffer) {
    let shape = 'other';
    let pathMatches = false;
    let methodMatches = false;
    if (status === 404 && body.length <= 2048) {
        try {
            const parsed = JSON.parse(body.toString('utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                pathMatches = parsed.path === path;
                methodMatches = parsed.method === method;
                if (parsed.error === 'Not found' && pathMatches && methodMatches)
                    shape = 'legacy_custom_not_found';
                else if (parsed.statusCode === 404 && parsed.error === 'Not Found'
                    && parsed.message === `Route ${method}:${path} not found`)
                    shape = 'fastify_default_not_found';
            }
        } catch { /* Untrusted response bytes are never reported. */ }
    }
    return { shape, pathMatches, methodMatches };
}
function genericDeliveryOracle(input: { runStatus: string | null; taskStatus: string | null;
    executionStatus: string | null; finishedAt: Date | null; answer: string | null;
    commitSha: string | null; helperPassed: boolean }) {
    const processCompleted = input.runStatus === 'completed' && input.taskStatus === 'completed'
        && input.executionStatus === 'completed';
    const durableFinish = processCompleted && input.finishedAt instanceof Date;
    const answerCandidatePassesLeakScreen = typeof input.answer === 'string' && input.answer.trim().length > 0
        && !/tokens used|you are (an|the) (ai|assistant)|codex (v|cli)|HAPPY_ORCH_PROMPT_B64/i.test(input.answer);
    const trustedAnswerVerified = answerCandidatePassesLeakScreen && input.helperPassed;
    return { processCompleted, durableFinish, answerCandidatePassesLeakScreen, trustedAnswerVerified,
        deliveryVerified: durableFinish && trustedAnswerVerified && Boolean(input.commitSha)
            && input.helperPassed };
}
function aiDispatchUpgradeOracle(input: { schedulerAttemptObserved: boolean; coordinatorPresent: boolean;
    workItemAbsent: boolean; errorCode: string | null; providerStarted: boolean;
    retryCount: number; sideEffectCount: number }) {
    return { verified: input.schedulerAttemptObserved && input.coordinatorPresent && input.workItemAbsent
        && input.errorCode === 'UPGRADE_REQUIRED' && !input.providerStarted
        && input.retryCount === 0 && input.sideEffectCount === 0,
    source: input.schedulerAttemptObserved ? 'actual_scheduler_pre_dispatch_gate' : 'scheduler_attempt_not_observed' };
}
const argv = process.argv.slice(2);
const option = (name: string) => { const index = argv.indexOf(name); return index < 0 ? null : argv[index + 1]; };
const oldRevision = option('--old-revision');
const oldRootInput = option('--old-root');
const publishedOldRootInput = option('--published-old-root');
const oldServerRootInput = option('--old-server-root');
const reportDir = option('--report-dir');
const verifyReportDir = option('--verify-report');
const managedDiagnostic = option('--managed-daemon-diagnostic');
const currentCliEntryInput = option('--current-cli-entry');
const currentCliSha256 = option('--current-cli-sha256');
const currentCliTreeSha256 = option('--current-cli-tree-sha256');
const currentCliBuildReport = option('--current-cli-build-report');
const socketBoundaryDiagnostic = option('--socket-boundary-diagnostic');
const oldSourceProvenance = option('--old-source-provenance');
const verifyOldRoot = option('--verify-old-root');
const verifyPublishedOldRootInput = option('--verify-published-old-root');
const selfTestOracles = argv.includes('--self-test-oracles');
const oldClientAiUpgradeProbe = option('--old-client-ai-upgrade-probe');
const schedulerTicksChild = option('--scheduler-ticks-child');
const daemonFinishRestart = argv.includes('--daemon-finish-restart');
const publishedGeneric = argv.includes('--published-generic');
const genericOldServer = argv.includes('--generic-old-server');
const expectOldServerAiRejection = argv.includes('--expect-old-server-ai-rejection');
const managedRedisPause = argv.includes('--managed-redis-pause');
const managedOwnerCancel = argv.includes('--managed-owner-cancel');
const managedInflightCancel = argv.includes('--managed-owner-inflight-cancel');
const managedOwnerSwitch = argv.includes('--managed-owner-switch') || managedOwnerCancel || managedInflightCancel;
const childMode = option('--server-child') ?? option('--cli-child')
    ?? option('--socket-server-child') ?? option('--machine-child')
    ?? option('--api-only-child');
const fixtureRoot = process.env.AI_COMPAT_FIXTURE_ROOT;
const artifactContextFile = process.env.AI_TEAM_ARTIFACT_CONTEXT_FILE ?? null;
if (artifactContextFile) {
    assert.match(resolve(artifactContextFile), /^\/tmp\/ai-team-artifact-context-[A-Za-z0-9-]+\.json$/);
    const stat = lstatSync(artifactContextFile);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Artifact context must be a regular file');
}
const artifactContextSha256 = artifactContextFile
    ? sha256(readFileSync(artifactContextFile)) : null;
const runtime = resolveProductionRuntime(root, artifactContextFile);
const runtimeRoot = runtime.runtimeRoot;
const importRuntime = (path: string) => import(productionModule(runtimeRoot, path));
const require = createRequire(join(runtimeRoot, 'packages/happy-server/package.json'));
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
function candidateDigest() {
    if (artifactContextFile && sha256(readFileSync(artifactContextFile)) !== artifactContextSha256)
        throw new Error('Artifact context changed during compatibility run');
    const result = spawnSync(process.execPath, ['scripts/aiTeamProductionPreflight.mjs',
        ...(artifactContextFile ? ['--artifact-context', artifactContextFile] : [])],
        { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000 });
    if (result.status !== 0) throw new Error('Candidate preflight failed');
    const audit = JSON.parse(result.stdout);
    assert.equal(audit.artifactContextSha256, artifactContextSha256);
    if (artifactContextFile) assert.equal(audit.artifactRuntimeRoot, runtimeRoot);
    return audit.candidateSha256 as string;
}

function inspectOldSourceProvenance(revision: string) {
    if (!/^[0-9a-f]{40}$/.test(revision) || argv.length !== 2)
        throw new Error('Usage: --old-source-provenance FULL_COMMIT_SHA');
    const git = (args: string[]) => spawnSync('git', args,
        { cwd: root, encoding: 'buffer', timeout: 30_000, maxBuffer: 20_000_000 });
    const commit = git(['rev-parse', '--verify', `${revision}^{commit}`]);
    assert.equal(commit.status, 0, 'Old revision unavailable');
    assert.equal(commit.stdout.toString().trim(), revision, 'Old revision must be a full commit SHA');
    const oldLock = git(['show', `${revision}:yarn.lock`]);
    assert.equal(oldLock.status, 0, 'Old lockfile unavailable');
    const trackedArtifacts = git(['ls-tree', '-r', '--name-only', revision, '--',
        'packages/happy-cli/dist', 'packages/happy-server/dist', 'packages/happy-wire/dist']);
    assert.equal(trackedArtifacts.status, 0);
    const currentLock = readFileSync(join(root, 'yarn.lock'));
    const report = {
        format: 'happy-ai-team-old-source-provenance-v1', oldRevision: revision,
        oldLockSha256: sha256(oldLock.stdout), currentLockSha256: sha256(currentLock),
        lockBytesEqual: oldLock.stdout.equals(currentLock),
        trackedOldArtifactCount: trackedArtifacts.stdout.toString().trim().split('\n').filter(Boolean).length,
        oldPublishedArtifact: 'unknown', oldInstalledDependencies: 'unknown',
        matrixScope: 'archived old source plus currently installed dependencies and wire dist',
        oldManagedDaemonReady: false,
    };
    console.log(JSON.stringify(report));
    process.exitCode = 1;
}

function verifyIsolatedOldRoot(path: string, revision: string) {
    const oldRoot = realpathSync(path);
    assert.notEqual(oldRoot, realpathSync(root), 'Old root must be independent');
    assert.ok(oldRoot.startsWith('/tmp/ai-team-old-source-'), 'Old root must be an owned /tmp checkout');
    const gitShow = (file: string) => {
        const result = spawnSync('git', ['show', `${revision}:${file}`],
            { cwd: root, timeout: 30_000, maxBuffer: 20_000_000 });
        assert.equal(result.status, 0, `Old Git source missing: ${file}`);
        return result.stdout;
    };
    const tree = spawnSync('git', ['ls-tree', '-r', '-z', revision],
        { cwd: root, timeout: 30_000, maxBuffer: 20_000_000 });
    assert.equal(tree.status, 0, 'Old Git tree unavailable');
    const tracked = tree.stdout.toString().split('\0').filter(Boolean);
    for (const entry of tracked) {
        const match = /^(100644|100755|120000) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
        assert.ok(match, 'Unsupported old tree entry');
        const [, mode, expected, file] = match;
        const path = join(oldRoot, file);
        const stat = lstatSync(path);
        assert.equal(mode === '120000' ? stat.isSymbolicLink() : stat.isFile(), true,
            `Old source type differs: ${file}`);
        if (mode !== '120000') assert.equal(Boolean(stat.mode & 0o111), mode === '100755',
            `Old source mode differs: ${file}`);
        const bytes = mode === '120000' ? Buffer.from(readlinkSync(path)) : readFileSync(path);
        const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        assert.equal(actual, expected, `Old source bytes differ: ${file}`);
    }
    assert.equal(sha256(readFileSync(join(oldRoot, 'yarn.lock'))), sha256(gitShow('yarn.lock')));
    for (const dependency of ['node_modules', 'packages/happy-cli/node_modules',
        'packages/happy-server/node_modules']) {
        const actual = realpathSync(join(oldRoot, dependency));
        assert.ok(actual.startsWith(`${oldRoot}/`), `Old dependency escapes isolated root: ${dependency}`);
    }
    const artifacts = ['packages/happy-wire/dist/index.mjs',
        'packages/happy-cli/dist/index.mjs'];
    const artifactSha256 = Object.fromEntries(artifacts.map((file) =>
        [file, sha256(readFileSync(join(oldRoot, file)))]));
    const machineSource = readFileSync(join(oldRoot, 'packages/happy-cli/src/api/apiMachine.ts'), 'utf8');
    return { oldRoot, oldLockSha256: sha256(readFileSync(join(oldRoot, 'yarn.lock'))),
        trackedSourceFiles: tracked.length, artifactSha256,
        oldFeaturesHandlerPresent: machineSource.includes("registerHandler('orchestrator-features'"),
        provenance: 'isolated source build; published binary unknown' };
}

async function verifyPublishedOldRoot(path: string) {
    const packageRoot = realpathSync(path);
    assert.ok(packageRoot.startsWith('/tmp/ai-team-published-old-')
        && packageRoot.endsWith('/package'), 'Published package must be isolated in owned /tmp');
    const archive = join(packageRoot, '..', 'package.tgz');
    const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    assert.equal(integrity,
        'sha512-oZnj0gqM0yy/hHMNZtf4LUo9aDHuIOeHf7bBmvvdqQgZ3MWZmjbsIVPF0NQlSwGTstxNCZGXdt3fTd9GwITjXg==',
        'Published npm tarball integrity differs');
    const packedIdentity = verifyPublishedNpmTree(packageRoot, runtimeRoot);
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'happy-next-cli');
    assert.equal(pkg.version, '0.10.0');
    const dependencyRoot = realpathSync(join(packageRoot, 'node_modules'));
    assert.ok(dependencyRoot.startsWith(`${packageRoot}/`), 'Published dependencies escape isolated root');
    const lock = JSON.parse(readFileSync(join(packageRoot, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages?.['']?.version, '0.10.0');
    return { ...packedIdentity, packageRoot, registryIntegrity: integrity,
        registryGitHeadObserved: '7f15e2bb0ed62a137d272fc3b11aeaa9f04dec4e',
        archiveSha256: sha256(readFileSync(archive)),
        packageLockSha256: sha256(readFileSync(join(packageRoot, 'package-lock.json'))),
        distIndexSha256: sha256(readFileSync(join(packageRoot, 'dist/index.mjs'))),
        provenance: 'verified npm tarball plus isolated npm dependency resolution; registry metadata gitHead is not a source build proof' };
}

async function reservePort() {
    const server = createNetServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((done) => server.close(() => done()));
    return port;
}

async function runOldClientAiUpgradeProbe(reportPath: string) {
    if (!publishedOldRootInput || argv.length !== 4 || existsSync(reportPath))
        throw new Error('Usage: --old-client-ai-upgrade-probe NEW_REPORT --published-old-root ISOLATED_NPM_PACKAGE');
    const published = await verifyPublishedOldRoot(publishedOldRootInput);
    const source = process.env.DATABASE_URL;
    if (!source) throw new Error('DATABASE_URL is required');
    const tag = randomBytes(8).toString('hex');
    const name = `happy_ai_compat_${tag}`;
    const url = new URL(source); url.pathname = `/${name}`;
    url.searchParams.set('connection_limit', '2');
    const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    const owned = mkdtempSync(join(tmpdir(), 'ai-team-upgrade-'));
    chmodSync(owned, 0o700);
    const home = join(owned, 'happy-home');
    const codexHome = join(owned, 'codex-home');
    const repo = join(owned, 'repo');
    const bin = join(owned, 'bin');
    for (const directory of [home, codexHome, repo, bin]) mkdirSync(directory, { mode: 0o700 });
    const [port, metricsPort, redisPort] = await Promise.all(Array.from({ length: 3 }, reservePort));
    const redisName = `ai-team-redis-${tag}`;
    const redisImage = 'sha256:487efc0616382465781b8fdc3d6d1db449e6fd80ae23bf48432a2da6b6929908';
    const serverSourceBefore = inventoryTree(runtimeRoot, join(runtimeRoot, 'packages/happy-server/sources')).sha256;
    const report: Record<string, unknown> = { format: 'happy-ai-team-old-client-upgrade-probe-v1',
        result: 'unknown', candidateBeforeSha256: candidateDigest(),
        artifactContextSha256, sourceRoot: root, runtimeRoot,
        serverSourceBeforeSha256: serverSourceBefore, oldPublishedCli: published,
        fixture: 'direct owned PostgreSQL Run/WorkItem; real old npm daemon and current Server scheduler; no public Project/Coordinator creation' };
    let created = false; let redisStarted = false;
    let server: ReturnType<typeof spawn> | null = null;
    let daemon: ReturnType<typeof spawn> | null = null;
    let fixture: InstanceType<typeof PrismaClient> | null = null;
    let failure: string | null = null;
    try {
        const started = spawnSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', redisName,
            '--label', `happy.ai-team.fixture=${tag}`, '--network', 'host', redisImage,
            'redis-server', '--bind', '127.0.0.1', '--port', String(redisPort),
            '--save', '', '--appendonly', 'no'], { encoding: 'utf8', timeout: 15_000 });
        assert.equal(started.status, 0, 'Owned Redis did not start');
        redisStarted = true;
        const adminRedisUrl = `redis://127.0.0.1:${redisPort}`;
        const Redis = require('ioredis');
        const redis = new Redis(adminRedisUrl, { maxRetriesPerRequest: 1, commandTimeout: 1000 });
        try {
            let ready = false;
            for (let i = 0; i < 40; i++) {
                try { if (await redis.ping() === 'PONG') { ready = true; break; } }
                catch { await new Promise((done) => setTimeout(done, 100)); }
            }
            assert.equal(ready, true, 'Owned Redis is unavailable');
        } finally { redis.disconnect(); }
        await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
        const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
            cwd: join(runtimeRoot, 'packages/happy-server'),
            env: { ...process.env, DATABASE_URL: url.toString() },
            encoding: 'utf8', timeout: 180_000, maxBuffer: 2_000_000 });
        assert.equal(migrated.status, 0, 'Owned database migration failed');
        fixture = new PrismaClient({ datasources: { db: { url: url.toString() } } });
        const git = (args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 10_000 });
        assert.equal(git(['init']).status, 0);
        assert.equal(git(['config', 'user.name', 'Upgrade Probe']).status, 0);
        assert.equal(git(['config', 'user.email', 'probe@example.invalid']).status, 0);
        writeFileSync(join(repo, 'README.md'), 'Owned upgrade probe\n', { mode: 0o600 });
        assert.equal(git(['add', '.']).status, 0);
        assert.equal(git(['commit', '-m', 'base']).status, 0);
        const base = git(['rev-parse', 'HEAD']).stdout.trim();
        const codexBinary = spawnSync('which', ['codex'], { encoding: 'utf8', timeout: 5_000 });
        assert.equal(codexBinary.status, 0, 'Codex binary missing for guarded PATH');
        const providerMarker = join(owned, 'provider-invoked');
        const wrapper = join(bin, 'codex');
        writeFileSync(wrapper, `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');\nconst {writeFileSync}=require('node:fs');\nif(process.argv.length===3&&process.argv[2]==='--version'){const r=spawnSync(${JSON.stringify(codexBinary.stdout.trim())},['--version'],{stdio:'inherit'});process.exit(r.status??70)}\nwriteFileSync(${JSON.stringify(providerMarker)},'blocked',{flag:'wx'});process.exit(73);\n`, { mode: 0o700 });
        const serverEnv = { ...process.env, DATABASE_URL: url.toString(), REDIS_URL: adminRedisUrl,
            PORT: String(port), METRICS_PORT: String(metricsPort) };
        server = spawn(join(runtimeRoot, 'node_modules/.bin/tsx'), ['--tsconfig', 'tsconfig.json', 'sources/main.ts'], {
            cwd: join(runtimeRoot, 'packages/happy-server'), env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
        let serverOutput = '';
        for (const stream of [server.stdout, server.stderr]) stream?.on('data', (chunk: Buffer) => {
            serverOutput = `${serverOutput}${chunk.toString()}`.slice(-100_000);
        });
        const baseUrl = `http://127.0.0.1:${port}`;
        let apiReady = false;
        for (let i = 0; i < 150; i++) {
            if (server.exitCode !== null) break;
            try {
                const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1000) });
                if (response.status < 500) { apiReady = true; break; }
            } catch { /* Owned server is starting. */ }
            await new Promise((done) => setTimeout(done, 200));
        }
        assert.equal(apiReady, true, 'Owned current Server did not start');
        const oldRequire = createRequire(join(published.packageRoot, 'package.json'));
        const nacl = oldRequire('tweetnacl');
        const pair = nacl.sign.keyPair();
        const challenge = nacl.randomBytes(32);
        const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
        const auth = await fetch(`${baseUrl}/v1/auth`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({
                publicKey: b64(pair.publicKey), challenge: b64(challenge),
                signature: b64(nacl.sign.detached(challenge, pair.secretKey)),
            }), signal: AbortSignal.timeout(5000) });
        assert.equal(auth.status, 200, 'Owned account authentication failed');
        const token = (await auth.json() as { token: string }).token;
        const accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;
        const machineKey = nacl.randomBytes(32);
        writeFileSync(join(home, 'access.key'), JSON.stringify({ encryption: {
            publicKey: b64(pair.publicKey), machineKey: b64(machineKey) }, token }), { mode: 0o600 });
        daemon = spawn(process.execPath, [join(published.packageRoot, 'bin/happy.mjs'), 'daemon', 'start-sync'], {
            cwd: published.packageRoot, env: { ...serverEnv, HAPPY_HOME_DIR: home, CODEX_HOME: codexHome,
                HAPPY_SERVER_URL: baseUrl, HAPPY_DISABLE_CAFFEINATE: 'true',
                PATH: `${bin}:${process.env.PATH ?? ''}` }, stdio: ['ignore', 'pipe', 'pipe'] });
        let daemonOutput = '';
        for (const stream of [daemon.stdout, daemon.stderr]) stream?.on('data', (chunk: Buffer) => {
            daemonOutput = `${daemonOutput}${chunk.toString()}`.slice(-100_000);
        });
        let machineId: string | null = null;
        for (let i = 0; i < 120; i++) {
            if (daemon.exitCode !== null) break;
            const context = await fetch(`${baseUrl}/v1/orchestrator/context`, {
                headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
            if (context.ok) {
                const data = await context.json() as { data?: { machines?: Array<{
                    machineId: string; dispatchReady?: boolean; providers?: string[] }> } };
                machineId = data.data?.machines?.find((machine) => machine.dispatchReady
                    && machine.providers?.includes('codex'))?.machineId ?? null;
            }
            if (machineId) break;
            await new Promise((done) => setTimeout(done, 250));
        }
        assert.ok(machineId, 'Actual old npm daemon did not register a Codex dispatch RPC');
        const routeClient = new Redis(adminRedisUrl, { maxRetriesPerRequest: 1, commandTimeout: 1000 });
        let dispatchRoutePresent = false; let featureRoutePresent = false;
        try {
            const route = (method: string) => `happy:rpc:route:v1:${sha256(`${accountId}\0${machineId}:${method}`)}`;
            dispatchRoutePresent = Boolean(await routeClient.get(route('orchestrator-dispatch')));
            featureRoutePresent = Boolean(await routeClient.get(route('orchestrator-features')));
        } finally { routeClient.disconnect(); }
        assert.equal(dispatchRoutePresent, true, 'Old daemon dispatch registration has no owned Redis route');
        const agent = await fixture.aiAgent.create({ data: { accountId, name: `upgrade-${tag}`,
            role: 'fixture', description: '', emoji: '', instructions: '', settings: { engine: 'codex' } } });
        const conversation = await fixture.aiConversation.create({ data: { accountId,
            scopeKey: tag, kind: 'direct', agentId: agent.id, title: tag } });
        const runs: Array<{ kind: 'coordinator' | 'work_item'; id: string; taskId: string }> = [];
        for (const kind of ['coordinator', 'work_item'] as const) {
            const run = await fixture.orchestratorRun.create({ data: { accountId,
                title: `Owned ${kind} upgrade probe`, status: 'running',
                metadata: { ...(kind === 'coordinator' ? { coordinatorChat: true } : {}),
                    aiRuntimeContract: { kind, structuredFinalResponseVersion: 1,
                        deliveryProofVersion: kind === 'work_item' ? 1 : 0 } },
                tasks: { create: { seq: 1, taskKey: kind, provider: 'codex',
                    prompt: 'Do not execute; this old client must be rejected before dispatch.',
                    workingDirectory: repo, permissionMode: 'read_only', targetMachineId: machineId,
                    status: 'queued', retryMaxAttempts: 3 } },
            }, include: { tasks: true } });
            if (kind === 'work_item') await fixture.aiWorkItem.create({ data: { accountId,
                title: `Owned ${kind}`, summary: 'Fixture', sourceType: 'execution',
                sourceLabel: 'compat probe', sourceResourceId: run.id, assigneeId: agent.id,
                conversationId: conversation.id, orchestratorRunId: run.id,
                orchestratorTaskId: run.tasks[0].id } });
            runs.push({ kind, id: run.id, taskId: run.tasks[0].id });
        }
        const observations: Array<Record<string, unknown>> = [];
        for (const entry of runs) {
            let row: Awaited<ReturnType<typeof fixture.orchestratorTask.findUnique>> = null;
            for (let i = 0; i < 80; i++) {
                row = await fixture.orchestratorTask.findUnique({ where: { id: entry.taskId } });
                if (row?.status === 'failed') break;
                await new Promise((done) => setTimeout(done, 250));
            }
            const waitUntil = Date.now() + 4_500;
            while (Date.now() < waitUntil) await new Promise((done) => setTimeout(done, 250));
            const [task, run, executions, workItems] = await Promise.all([
                fixture.orchestratorTask.findUniqueOrThrow({ where: { id: entry.taskId } }),
                fixture.orchestratorRun.findUniqueOrThrow({ where: { id: entry.id } }),
                fixture.orchestratorExecution.findMany({ where: { taskId: entry.taskId } }),
                fixture.aiWorkItem.count({ where: { orchestratorRunId: entry.id } }),
            ]);
            const execution = executions[0];
            const [events, usage] = execution ? await Promise.all([
                fixture.aiPersistentExecutionEvent.count({ where: { executionId: execution.id } }),
                fixture.aiUsageDelta.count({ where: { executionId: execution.id } }),
            ]) : [0, 0];
            const sideEffectCount = events + usage + Number(Boolean(task.commitSha || execution?.commitSha));
            observations.push({ kind: entry.kind, runStatus: run.status, taskStatus: task.status,
                taskErrorCode: task.errorCode, executionCount: executions.length,
                executionStatus: execution?.status ?? null, executionErrorCode: execution?.errorCode ?? null,
                providerPidPresent: Boolean(execution?.pid),
                workItemCount: workItems, retryMaxAttempts: task.retryMaxAttempts,
                sideEffectCount, gate: entry.kind === 'coordinator' ? aiDispatchUpgradeOracle({
                    schedulerAttemptObserved: Boolean(execution), coordinatorPresent: true, workItemAbsent: workItems === 0,
                    errorCode: execution?.errorCode ?? task.errorCode,
                    providerStarted: Boolean(execution?.pid) || existsSync(providerMarker),
                    retryCount: Math.max(0, executions.length - 1), sideEffectCount }) : null });
        }
        const ticks = spawnSync(join(runtimeRoot, 'node_modules/.bin/tsx'), ['--tsconfig', 'tsconfig.json',
            fileURLToPath(import.meta.url), '--scheduler-ticks-child', accountId], {
            cwd: join(runtimeRoot, 'packages/happy-server'), env: serverEnv,
            encoding: 'utf8', timeout: 30_000, maxBuffer: 200_000 });
        assert.equal(ticks.status, 0, 'Four isolated scheduler ticks failed');
        const afterTicks = await Promise.all(runs.map(async (entry) => ({
            kind: entry.kind, executions: await fixture!.orchestratorExecution.count({
                where: { taskId: entry.taskId } }),
            taskStatus: (await fixture!.orchestratorTask.findUniqueOrThrow({ where: { id: entry.taskId } })).status,
        })));
        report.afterFourTicks = { workerExitCode: ticks.status,
            markerPresent: ticks.stdout.includes('AI_COMPAT_FOUR_SCHEDULER_TICKS_OK'), rows: afterTicks };
        const after = git(['rev-parse', 'HEAD']).stdout.trim();
        const porcelain = git(['status', '--porcelain']).stdout.trim();
        const daemonState = existsSync(join(home, 'daemon.state.json'))
            ? JSON.parse(readFileSync(join(home, 'daemon.state.json'), 'utf8')) : null;
        report.machine = { registered: true, machineId,
            oldDaemonPid: Number.isSafeInteger(daemonState?.pid) ? daemonState.pid : null,
            oldDaemonProcessStarted: Boolean(daemon.pid), oldDaemonExitCode: daemon.exitCode,
            dispatchRoutePresent, featureRoutePresent, nonceResponse: 'not_requested_when_feature_route_absent' };
        report.observations = observations;
        report.git = { baseEqualsAfter: base === after, dirty: Boolean(porcelain),
            providerBlockedMarkerPresent: existsSync(providerMarker) };
        report.serverLogSha256 = sha256(serverOutput);
        report.daemonLogSha256 = sha256(daemonOutput);
        report.result = observations.length === 2
            && (observations[0].gate as { verified: boolean })?.verified === true
            && observations[0].workItemCount === 0 && observations[1].workItemCount === 1
            && observations.every((item) =>
            item.runStatus === 'failed' && item.taskStatus === 'failed'
            && item.executionStatus === 'failed' && item.executionErrorCode === 'UPGRADE_REQUIRED'
            && item.executionCount === 1 && item.providerPidPresent === false
            && item.sideEffectCount === 0)
            && afterTicks.every((item) => item.executions === 1 && item.taskStatus === 'failed')
            && dispatchRoutePresent && !featureRoutePresent
            && base === after && !porcelain && !existsSync(providerMarker) ? 'passed' : 'failed';
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        report.result = 'failed';
    } finally {
        for (const child of [daemon, server]) {
            if (!child || child.exitCode !== null || child.signalCode !== null) continue;
            child.kill('SIGTERM');
            await new Promise<void>((done) => {
                const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
                child.once('exit', () => { clearTimeout(timer); done(); });
            });
        }
        const statePath = join(home, 'daemon.state.json');
        if (existsSync(statePath)) {
            try {
                const state = JSON.parse(readFileSync(statePath, 'utf8'));
                if (Number.isSafeInteger(state.pid) && state.pid > 0
                    && readFileSync(`/proc/${state.pid}/environ`).includes(Buffer.from(`HAPPY_HOME_DIR=${home}\0`))) {
                    process.kill(state.pid, 'SIGTERM');
                    await new Promise((done) => setTimeout(done, 500));
                    if (existsSync(`/proc/${state.pid}/environ`)) process.kill(state.pid, 'SIGKILL');
                }
            } catch { /* Owned daemon may have exited. */ }
        }
        await fixture?.$disconnect();
        if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
        const rows = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
            'SELECT count(*)::bigint AS count FROM pg_database WHERE datname=$1', name);
        await admin.$disconnect();
        const residual = Number(rows[0].count);
        rmSync(owned, { recursive: true, force: true });
        let redisRemoved = false;
        if (redisStarted) {
            const stopped = spawnSync('docker', ['rm', '-f', redisName], { timeout: 15_000 });
            redisRemoved = stopped.status === 0;
        }
        report.cleanup = { databaseResidual: residual, homeRemoved: !existsSync(owned),
            redisContainerRemoved: redisRemoved };
        report.serverSourceAfterSha256 = inventoryTree(runtimeRoot, join(runtimeRoot, 'packages/happy-server/sources')).sha256;
        report.serverSourceStable = report.serverSourceBeforeSha256 === report.serverSourceAfterSha256;
        const afterOldNpm = verifyPublishedNpmTree(published.packageRoot, runtimeRoot);
        report.oldPublishedCliAfter = afterOldNpm;
        report.oldPublishedCliStable = afterOldNpm.packedTreeSha256 === published.packedTreeSha256
            && afterOldNpm.generatedLockSha256 === published.generatedLockSha256;
        if (!report.oldPublishedCliStable) report.candidateStable = false;
        report.candidateAfterSha256 = candidateDigest();
        report.candidateStable = report.candidateBeforeSha256 === report.candidateAfterSha256;
        if (!report.candidateStable && report.result === 'passed') report.result = 'unknown';
        if (failure) report.failureClass = failure.startsWith('Actual old npm daemon')
            ? 'old_daemon_registration' : failure.startsWith('Owned current Server')
                ? 'server_startup' : 'fixture_or_contract';
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ result: report.result, serverSourceStable: report.serverSourceStable,
            candidateStable: report.candidateStable, observations: report.observations,
            cleanup: report.cleanup, reportSha256: sha256(readFileSync(reportPath)) }));
    }
    if (report.result !== 'passed' || (report.cleanup as { databaseResidual: number }).databaseResidual !== 0)
        process.exitCode = 1;
}

async function runManagedDiagnostic(reportPath: string) {
    const explicitCliFields = [currentCliEntryInput, currentCliSha256,
        currentCliTreeSha256, currentCliBuildReport];
    if (artifactContextFile && explicitCliFields.some(Boolean))
        throw new Error('Fresh artifact context and legacy explicit CLI bundle fields are mutually exclusive');
    if (explicitCliFields.some(Boolean) && !explicitCliFields.every(Boolean))
        throw new Error('Current CLI entry, entry SHA-256, whole dist SHA-256 and build report must be supplied together');
    for (const digest of [currentCliSha256, currentCliTreeSha256]) {
        if (digest && !/^[0-9a-f]{64}$/.test(digest)) throw new Error('CLI digest must be lowercase hex');
    }
    if (artifactContextFile) candidateDigest();
    const boundContext = artifactContextFile
        ? JSON.parse(readFileSync(artifactContextFile, 'utf8')) as { artifactRoot: string;
            freshBuildReport: string } : null;
    const currentCliEntry = currentCliEntryInput ? realpathSync(currentCliEntryInput)
        : boundContext ? realpathSync(join(boundContext.artifactRoot, 'packages/happy-cli/dist/index.mjs')) : null;
    const currentCliTree = () => {
        assert.ok(currentCliEntry);
        if (boundContext) {
            const tree = inventoryTree(boundContext.artifactRoot,
                join(boundContext.artifactRoot, 'packages/happy-cli/dist'));
            return { files: tree.files.length, sha256: tree.sha256 };
        }
        const tree = inventoryTree(resolve(currentCliEntry, '../..'), resolve(currentCliEntry, '..'));
        const files = tree.files.map((file: { path: string; mode: number; sha256: string }) => ({
            ...file, path: file.path.replace(/^dist\//, 'packages/happy-cli/dist/'),
        }));
        return { files: files.length, sha256: sha256(JSON.stringify(files)) };
    };
    let currentCliBuild: Record<string, unknown> | null = null;
    const effectiveCliSha256 = currentCliEntry && boundContext
        ? sha256(readFileSync(currentCliEntry)) : currentCliSha256;
    const effectiveCliTreeSha256 = currentCliEntry && boundContext
        ? currentCliTree().sha256 : currentCliTreeSha256;
    const effectiveBuildReport = boundContext?.freshBuildReport ?? currentCliBuildReport;
    if (currentCliEntry) {
        assert.ok(currentCliEntry.startsWith('/tmp/'), 'Explicit current CLI entry must be isolated under /tmp');
        assert.equal(lstatSync(currentCliEntry).isFile(), true);
        assert.equal(sha256(readFileSync(currentCliEntry)), effectiveCliSha256,
            'Explicit current CLI bundle differs from supplied digest');
        assert.equal(currentCliTree().sha256, effectiveCliTreeSha256,
            'Explicit current CLI dist tree differs from supplied digest');
        const buildBytes = readFileSync(effectiveBuildReport!);
        const build = JSON.parse(buildBytes.toString('utf8'));
        if (boundContext) {
            assert.equal(build.format, 'happy-ai-team-fresh-consumer-build-v1');
            assert.equal(build.root, boundContext.artifactRoot);
            assert.equal(build.lockSha256, sha256(readFileSync(join(root, 'yarn.lock'))));
            assert.equal(build.consumerChecksPassed, true);
            assert.equal(build.steps?.find((step: { step: string }) => step.step === 'cli-normal-build')?.exitCode, 0);
            currentCliBuild = { reportSha256: sha256(buildBytes), sourceInputsSha256: build.sourceSha256,
                rootLockSha256: build.lockSha256, provenance: 'bound fresh local build; published binary unknown' };
        } else {
            assert.equal(build.format, 'happy-ai-formal-local-build-v1');
            assert.equal(build.inputsStable, true);
            assert.equal(build.artifacts?.cliDist?.sha256, effectiveCliTreeSha256);
            assert.equal(build.isolatedCliEntrySha256, effectiveCliSha256);
            assert.equal(build.rootLockSha256, sha256(readFileSync(join(root, 'yarn.lock'))));
            assert.equal(build.commands?.cliPkgroll?.exitCode, 0);
            currentCliBuild = { reportSha256: sha256(buildBytes), sourceInputsSha256: build.sourceInputsSha256,
                rootLockSha256: build.rootLockSha256, provenance: 'local build report; published artifact unknown' };
        }
    }
    if (managedRedisPause && managedOwnerSwitch) throw new Error('Choose one managed boundary');
    if (oldRootInput && publishedOldRootInput) throw new Error('Choose one old CLI source');
    if (genericOldServer && !oldServerRootInput) throw new Error('Generic old Server diagnostic requires old Server root');
    if (expectOldServerAiRejection && (!oldServerRootInput || genericOldServer))
        throw new Error('AI rejection oracle requires old Server and the AI Project route');
    if (oldServerRootInput && (oldRootInput || publishedOldRootInput)) throw new Error('Choose one old component');
    if (publishedGeneric && !publishedOldRootInput) throw new Error('Generic published diagnostic requires npm root');
    if (argv.length !== (oldRootInput || oldServerRootInput ? 6 : publishedOldRootInput ? 4 : 2)
        + Number(daemonFinishRestart) + Number(publishedGeneric) + Number(genericOldServer)
        + Number(expectOldServerAiRejection)
        + Number(managedRedisPause) + Number(managedOwnerSwitch)
        + (currentCliEntryInput ? 8 : 0)
        || existsSync(reportPath))
        throw new Error('Usage: --managed-daemon-diagnostic NEW_REPORT_PATH [--old-root PATH | --old-server-root PATH] --old-revision FULL_SHA | --published-old-root PACKAGE [--daemon-finish-restart | --managed-redis-pause | --managed-owner-switch] [--published-generic | --generic-old-server]');
    if (oldRootInput || oldServerRootInput) assert.match(oldRevision ?? '', /^[0-9a-f]{40}$/);
    const oldProvenance = oldRootInput
        ? { oldRevision, ...verifyIsolatedOldRoot(oldRootInput, oldRevision!) }
        : publishedOldRootInput ? await verifyPublishedOldRoot(publishedOldRootInput) : null;
    const oldServerProvenance = oldServerRootInput
        ? { oldRevision, ...verifyIsolatedOldRoot(oldServerRootInput, oldRevision!) } : null;
    const oldServerTrackedBefore = oldServerProvenance
        ? verifyOldServerTrackedTree(oldServerProvenance.oldRoot, oldRevision!, root) : null;
    const configured = process.env.DATABASE_URL;
    if (!configured) throw new Error('DATABASE_URL is required');
    const tag = randomBytes(8).toString('hex');
    const name = `happy_ai_compat_${tag}`;
    const databaseUrl = new URL(configured);
    databaseUrl.pathname = `/${name}`;
    databaseUrl.searchParams.set('connection_limit', '2');
    const adminUrl = new URL(configured);
    adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    const children: Array<ReturnType<typeof spawn>> = [];
    const bridgeObservers = new Set<{ disconnect(): void }>();
    const ports = await Promise.all(Array.from({ length: 5 }, reservePort));
    const [apiA, apiB, metricsA, metricsB, proxyPort] = ports;
    const report: Record<string, unknown> = { format: 'happy-ai-team-managed-diagnostic-v1',
        candidateBeforeSha256: candidateDigest(), artifactContextSha256,
        sourceRoot: root, runtimeRoot, result: 'unknown',
        scope: expectOldServerAiRejection ? 'old-source-server-public-project-route-rejection-only'
            : genericOldServer ? 'current-cli-daemon-isolated-old-source-server-generic-orchestrator'
            : publishedGeneric ? 'published-npm-old-cli-daemon-current-server-generic-orchestrator'
            : publishedOldRootInput ? 'published-npm-old-cli-daemon-current-server-local-project'
            : oldProvenance ? 'isolated-old-cli-daemon-current-server-local-project'
            : 'actual-server-a-b-and-cli-daemon-local-project',
        oldBuild: oldProvenance, oldServerBuild: oldServerProvenance,
        oldServerTrackedBefore,
        currentCliBundle: currentCliEntry ? { entry: currentCliEntry,
            sha256: effectiveCliSha256, treeSha256: effectiveCliTreeSha256,
            treeFiles: currentCliTree().files, build: currentCliBuild,
            provenance: 'explicit isolated local build; published binary unknown' }
            : { entry: 'packages/happy-cli/bin/happy.mjs',
                distSha256: sha256(readFileSync(join(runtimeRoot, 'packages/happy-cli/dist/index.mjs'))),
                provenance: 'shared dist; may lag active CLI source' },
        daemonFinishRestartRequested: daemonFinishRestart,
        managedBoundary: managedRedisPause ? 'redis-pause'
            : managedInflightCancel ? 'owner-inflight-cancel'
                : managedOwnerCancel ? 'owner-cancel' : managedOwnerSwitch ? 'owner-switch' : null };
    let created = false;
    let proxy: ReturnType<typeof createHttpServer> | null = null;
    let tempHome: string | null = null;
    const ownedTemp = mkdtempSync(join(tmpdir(), 'ai-team-managed-'));
    chmodSync(ownedTemp, 0o700);
    let ownedMachines: Array<{ id: string; accountId: string }> = [];
    let cliOutput = '';
    const originalRedisUrl = process.env.REDIS_URL;
    const isolatedRedis = managedRedisPause || managedOwnerSwitch;
    const redisContainer = `ai-team-redis-${tag}`;
    let redisStarted = false;
    let redisPaused = false;
    try {
        if (isolatedRedis) {
            const redisPort = await reservePort();
            const image = 'sha256:487efc0616382465781b8fdc3d6d1db449e6fd80ae23bf48432a2da6b6929908';
            const started = spawnSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', redisContainer,
                '--label', `happy.ai-team.fixture=${tag}`, '--network', 'host', image,
                'redis-server', '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '',
                '--appendonly', 'no'], { encoding: 'utf8', timeout: 15_000 });
            assert.equal(started.status, 0, 'Owned Redis container did not start');
            redisStarted = true;
            process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
            const Redis = require('ioredis');
            const probe = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
            try {
                const began = Date.now(); let ready = false;
                while (Date.now() - began < 10_000) {
                    try { ready = await probe.ping() === 'PONG'; if (ready) break; }
                    catch { await new Promise((done) => setTimeout(done, 100)); }
                }
                assert.equal(ready, true, 'Owned Redis did not become ready');
            } finally { probe.disconnect(); }
        }
        assert.match(name, /^happy_ai_compat_[0-9a-f]{16}$/);
        await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
        created = true;
        const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
            cwd: join(runtimeRoot, 'packages/happy-server'),
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            encoding: 'utf8', timeout: 180_000, maxBuffer: 2_000_000 });
        assert.equal(migrate.status, 0, 'Owned database migration failed');
        const tsx = join(runtimeRoot, 'node_modules/.bin/tsx');
        const serverEnv = (port: number, metricsPort: number) => ({ ...process.env,
            DATABASE_URL: databaseUrl.toString(), PORT: String(port), METRICS_PORT: String(metricsPort) });
        let apiOnlyReady = false;
        for (const [index, [port, metricsPort]] of [[apiA, metricsA], [apiB, metricsB]].entries()) {
            const serverSource = index === 1 && oldServerProvenance
                ? oldServerProvenance.oldRoot : runtimeRoot;
            const child = spawn(index === 1 && oldServerProvenance
                ? join(serverSource, 'node_modules/.bin/tsx') : tsx, index === 0
                ? ['--tsconfig', 'tsconfig.json', fileURLToPath(import.meta.url), '--api-only-child', 'current']
                : ['--tsconfig', 'tsconfig.json', 'sources/main.ts'], {
                cwd: join(serverSource, 'packages/happy-server'),
                env: { ...serverEnv(port, metricsPort), ...(index === 0 && managedInflightCancel ? {
                    AI_TEAM_ACK_BARRIER_DIR: ownedTemp,
                    AI_TEAM_ACK_BARRIER_SERVER_ROOT: join(runtimeRoot, 'packages/happy-server'),
                    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${join(root, 'scripts/aiTeamCompatibilityAckBarrier.cjs')}`,
                } : {}) },
                stdio: ['ignore', 'pipe', 'pipe'] });
            children.push(child);
            child.stdout?.setEncoding('utf8');
            child.stdout?.on('data', (chunk: string) => {
                if (index === 0 && chunk.includes('AI_COMPAT_PRODUCTION_API_SOCKET_ONLY_READY'))
                    apiOnlyReady = true;
            });
            child.stderr?.resume();
        }
        for (const port of [apiA, apiB]) {
            const started = Date.now();
            let ready = false;
            while (Date.now() - started < 30_000) {
                if (children.some((child) => child.exitCode !== null)) break;
                try {
                    const response = await fetch(`http://127.0.0.1:${port}/v1/version`,
                        { signal: AbortSignal.timeout(1000) });
                    if (response.status < 500) { ready = true; break; }
                } catch { /* Wait for the owned API listener. */ }
                await new Promise((done) => setTimeout(done, 200));
            }
            assert.equal(ready, true, 'Owned actual Server did not become ready');
        }
        const markerStarted = Date.now();
        while (!apiOnlyReady && Date.now() - markerStarted < 2000)
            await new Promise((done) => setTimeout(done, 25));
        assert.equal(apiOnlyReady, true, 'A did not start in production API/Socket-only mode');
        report.onlyBStartsScheduler = true;
        const proxyRequire = createRequire(join(runtimeRoot, 'packages/happy-cli/package.json'));
        const httpProxy = proxyRequire('http-proxy');
        const forwardHttp = httpProxy.createProxyServer({ target: `http://127.0.0.1:${apiB}` });
        if (oldServerRootInput) forwardHttp.on('proxyRes', (upstream: any, request: any) => {
            const path = typeof request.url === 'string' ? request.url.split('?')[0] : '';
            const method = typeof request.method === 'string' ? request.method : '';
            if (upstream.statusCode !== 404 || method !== 'POST'
                || !/^\/v1\/ai-team\/(?:executions\/[A-Za-z0-9_-]+\/capabilities|projects)$/.test(path)) return;
            let body = Buffer.alloc(0);
            upstream.on('data', (chunk: Buffer) => {
                if (body.length <= 2048) body = Buffer.concat([body, chunk]).subarray(0, 2049);
            });
            upstream.once('end', () => {
                const failures = (report.oldServerHttpResponseShapes ??= []) as Array<Record<string, unknown>>;
                if (failures.length >= 8) return;
                failures.push({ route: path.replace(/\/executions\/[A-Za-z0-9_-]+\//,
                    '/executions/:executionId/'), status: 404,
                    ...classifyNotFoundResponse(method, path, 404, body) });
            });
        });
        const forwardSocketA = httpProxy.createProxyServer({ target: `http://127.0.0.1:${oldServerProvenance ? apiB : apiA}`, ws: true });
        const forwardSocketB = httpProxy.createProxyServer({ target: `http://127.0.0.1:${apiB}`, ws: true });
        const openSockets = new Set<import('node:net').Socket>();
        let socketOwner = 'A';
        let boundaryTriggered = false;
        const readOwner = async () => {
            const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
            const Redis = require('ioredis');
            const client = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, commandTimeout: 1000 });
            try {
                const machine = await fixture.machine.findFirst({ select: { id: true, accountId: true } });
                if (!machine) return null;
                const routeId = sha256(`${machine.accountId}\0${machine.id}:orchestrator-dispatch`);
                const raw = await client.get(`happy:rpc:route:v1:${routeId}`);
                return raw ? JSON.parse(raw) as { instanceId: string; epoch: number } : null;
            } finally { client.disconnect(); await fixture.$disconnect(); }
        };
        proxy = createHttpServer((request, response) => {
            const boundaryPath = request.url?.split('?')[0] ?? '';
            const matchesBoundary = managedOwnerCancel || managedInflightCancel
                ? /^\/v1\/orchestrator\/runs\/[A-Za-z0-9_-]+\/cancel$/.test(boundaryPath)
                : boundaryPath === '/v1/ai-team/projects';
            if ((!managedRedisPause && !managedOwnerSwitch) || boundaryTriggered
                || request.method !== 'POST' || !matchesBoundary) {
                if (genericOldServer) response.once('finish', () => {
                    if (response.statusCode >= 400 && response.statusCode < 600
                        && /^\/v1\/[A-Za-z0-9_/-]{1,160}$/.test(boundaryPath)) {
                        const failures = (report.oldServerHttpFailures ??= []) as Array<{ method: string; path: string; status: number }>;
                        if (failures.length < 20) failures.push({ method: request.method ?? 'UNKNOWN',
                            path: boundaryPath
                                .replace(/\/tasks\/[A-Za-z0-9_-]+\//, '/tasks/:taskId/')
                                .replace(/\/executions\/[A-Za-z0-9_-]+\//, '/executions/:executionId/'),
                            status: response.statusCode });
                    }
                });
                forwardHttp.web(request, response); return;
            }
            boundaryTriggered = true;
            void (async () => {
                if (managedOwnerCancel || managedInflightCancel)
                    report.ownerCancelRunId = boundaryPath.split('/')[4];
                const chunks: Buffer[] = []; let size = 0;
                for await (const chunk of request) {
                    size += chunk.length;
                    if (size > 1_000_000) throw new Error('Owned Project request too large');
                    chunks.push(chunk);
                }
                const body = Buffer.concat(chunks);
                const headers: Record<string, string> = {};
                for (const key of ['authorization', 'content-type', 'idempotency-key']) {
                    const value = request.headers[key];
                    if (typeof value === 'string') headers[key] = value;
                }
                const send = () => fetch(`http://127.0.0.1:${apiB}${request.url}`, {
                    method: 'POST', headers, body, signal: AbortSignal.timeout(10_000),
                });
                if (managedOwnerSwitch) {
                    const before = await readOwner();
                    assert.ok(before && before.epoch > 0, 'Actual daemon owner A was not registered');
                    let inFlight: Promise<Response> | null = null;
                    let observer: any = null;
                    let observedRequestId: string | null = null;
                    let observedOldError: string | null = null;
                    if (managedInflightCancel) {
                        const Redis = require('ioredis');
                        observer = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
                        bridgeObservers.add(observer);
                        observer.on('pmessage', (_pattern: string, _channel: string, raw: string) => {
                            try {
                                const message = JSON.parse(raw);
                                if (message.type === 'request'
                                    && typeof message.route?.method === 'string'
                                    && message.route.method.endsWith(':orchestrator-cancel')) {
                                    observedRequestId = message.id;
                                }
                                if (message.type === 'response' && message.id === observedRequestId)
                                    observedOldError = message.error ?? null;
                            } catch { /* Do not expose bridge payloads. */ }
                        });
                        await observer.psubscribe('happy:rpc:bridge:v1:*');
                        inFlight = send();
                        void inFlight.catch(() => {});
                        const barrier = join(ownedTemp, 'cancel-ack-returned');
                        const began = Date.now();
                        while (!existsSync(barrier) && Date.now() - began < 20_000)
                            await new Promise((done) => setTimeout(done, 20));
                        assert.equal(existsSync(barrier), true,
                            'Actual daemon cancel ACK did not reach the A barrier');
                        assert.ok(observedRequestId, 'No matching cancel bridge request reached A');
                    }
                    socketOwner = 'B';
                    for (const socket of openSockets) socket.destroy();
                    let after: Awaited<ReturnType<typeof readOwner>> = null;
                    const began = Date.now();
                    while (Date.now() - began < 15_000) {
                        await new Promise((done) => setTimeout(done, 200));
                        after = await readOwner();
                        if (after && after.instanceId !== before.instanceId && after.epoch > before.epoch) break;
                    }
                    report.ownerSwitch = { beforeEpoch: before.epoch, afterEpoch: after?.epoch ?? null,
                        instanceChanged: Boolean(after && after.instanceId !== before.instanceId),
                        epochAdvanced: Boolean(after && after.epoch > before.epoch),
                        oldAckRejected: false, actualDaemonAckHeld: managedInflightCancel
                            && existsSync(join(ownedTemp, 'cancel-ack-returned')) };
                    assert.equal((report.ownerSwitch as { epochAdvanced: boolean }).epochAdvanced, true,
                        'Actual daemon did not move to B owner epoch');
                    if (managedInflightCancel) {
                        writeFileSync(join(ownedTemp, 'cancel-ack-release'), '', { flag: 'wx', mode: 0o600 });
                        const first = await inFlight!;
                        const firstBody = Buffer.from(await first.arrayBuffer());
                        const began = Date.now();
                        while (!observedOldError && Date.now() - began < 2000)
                            await new Promise((done) => setTimeout(done, 20));
                        (report.ownerSwitch as Record<string, unknown>).oldAckRejected =
                            Boolean(observedRequestId) && observedOldError === 'RPC owner changed';
                        (report.ownerSwitch as Record<string, unknown>).bridgeRequestMatched =
                            Boolean(observedRequestId) && observedOldError !== null;
                        (report.ownerSwitch as Record<string, unknown>).cancelHttpStatus = first.status;
                        observer.disconnect();
                        bridgeObservers.delete(observer);
                        response.writeHead(first.status, { 'content-type': first.headers.get('content-type') ?? 'application/json' });
                        response.end(firstBody);
                        return;
                    }
                }
                if (managedRedisPause) {
                    const paused = spawnSync('docker', ['pause', redisContainer], { timeout: 10_000 });
                    assert.equal(paused.status, 0, 'Owned Redis pause failed');
                    redisPaused = true;
                    let firstStatus = 0; let firstRetryAfter: string | null = null;
                    let firstErrorClass = 'unknown';
                    let firstErrorCode: string | null = null;
                    try {
                        const first = await send();
                        firstStatus = first.status;
                        firstRetryAfter = first.headers.get('retry-after');
                        const bytes = Buffer.from(await first.arrayBuffer());
                        try {
                            const payload = JSON.parse(bytes.toString('utf8'));
                            const error = payload.error;
                            if (typeof payload.errorCode === 'string'
                                && /^[A-Z0-9_]{1,64}$/.test(payload.errorCode))
                                firstErrorCode = payload.errorCode;
                            if (typeof error === 'string') {
                                firstErrorClass = error.includes('verifier is unavailable')
                                    ? 'registered_verifier_unavailable'
                                    : error.includes('RPC bridge unavailable') ? 'rpc_bridge_unavailable'
                                        : error.includes('timed out') ? 'rpc_timeout' : 'other';
                            }
                        } catch { /* Only report a fixed error class. */ }
                    } finally {
                        const unpaused = spawnSync('docker', ['unpause', redisContainer], { timeout: 10_000 });
                        assert.equal(unpaused.status, 0, 'Owned Redis unpause failed');
                        redisPaused = false;
                    }
                    await new Promise((done) => setTimeout(done, 500));
                    const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
                    let count: number; let projects: number;
                    try {
                        count = await fixture.orchestratorRun.count();
                        projects = await fixture.aiProject.count();
                    }
                    finally { await fixture.$disconnect(); }
                    report.redisPause = { firstStatus, retryAfterPresent: Boolean(firstRetryAfter),
                        firstErrorClass, firstErrorCode, runsAfterFirstFailure: count,
                        projectsAfterFirstFailure: projects, replayedSameBytes: true };
                    const retry = await send();
                    (report.redisPause as Record<string, unknown>).retryStatus = retry.status;
                    response.writeHead(retry.status, { 'content-type': retry.headers.get('content-type') ?? 'application/json' });
                    response.end(Buffer.from(await retry.arrayBuffer()));
                    return;
                }
                const forwarded = await send();
                response.writeHead(forwarded.status, { 'content-type': forwarded.headers.get('content-type') ?? 'application/json' });
                response.end(Buffer.from(await forwarded.arrayBuffer()));
            })().catch((error) => {
                report.boundaryFailureCode = error instanceof Error ? error.name : 'UnknownError';
                if (!response.headersSent) response.writeHead(503, { 'content-type': 'application/json' });
                response.end('{"error":"Owned network boundary failed"}');
            });
        });
        proxy.on('upgrade', (request, socket, head) => {
            openSockets.add(socket);
            socket.on('close', () => openSockets.delete(socket));
            (socketOwner === 'B' ? forwardSocketB : forwardSocketA).ws(request, socket, head);
        });
        for (const bridge of [forwardHttp, forwardSocketA, forwardSocketB]) bridge.on('error', () => {});
        await new Promise<void>((done) => proxy!.listen(proxyPort, '127.0.0.1', done));
        const cli = spawn(process.execPath, [join(runtimeRoot, 'packages/happy-cli/scripts/ai-team-p0-real-e2e.mjs')], {
            cwd: publishedOldRootInput ? (oldProvenance as { packageRoot: string }).packageRoot
                : join(oldRootInput ? (oldProvenance as { oldRoot: string }).oldRoot : runtimeRoot,
                    'packages/happy-cli'),
            env: { ...process.env, DATABASE_URL: databaseUrl.toString(),
                HAPPY_TEST_SERVER_URL: `http://127.0.0.1:${proxyPort}`,
                ...(currentCliEntry ? { HAPPY_TEST_CLI_ENTRY: currentCliEntry } : {}),
                ...(publishedGeneric || genericOldServer || managedOwnerCancel || managedInflightCancel
                    ? {} : { HAPPY_TEST_PROJECT: '1' }),
                ...(managedOwnerCancel || managedInflightCancel
                    ? { HAPPY_TEST_PROVIDER_CANCEL: '1' } : {}),
                ...(daemonFinishRestart ? { HAPPY_TEST_OFFLINE_FINISH_PROXY: '1' } : {}),
                TMPDIR: ownedTemp }, stdio: ['ignore', 'pipe', 'pipe'] });
        children.push(cli);
        for (const stream of [cli.stdout, cli.stderr]) {
            stream?.setEncoding('utf8');
            stream?.on('data', (chunk: string) => { cliOutput = `${cliOutput}${chunk}`.slice(-200_000); });
        }
        let cliTimer: ReturnType<typeof setTimeout> | undefined;
        const cliExit = await Promise.race([
            new Promise<number | null>((done) => cli.once('exit', (code) => done(code))),
            new Promise<null>((done) => { cliTimer = setTimeout(() => done(null), 420_000); }),
        ]);
        if (cliTimer) clearTimeout(cliTimer);
        if (cliExit === null && cli.exitCode === null) cli.kill('SIGTERM');
        const homeMatch = cliOutput.match(/P0_TEST_HOME=([^\n]+)/);
        tempHome = homeMatch?.[1] ?? null;
        if (tempHome) assert.ok(tempHome.startsWith(`${ownedTemp}/happy-p0-cli-real-`));
        const passLine = cliOutput.split('\n').find((line) => line.startsWith('{"result":"PASS"'));
        const pass = passLine ? JSON.parse(passLine) : null;
        report.cliExitCode = cliExit;
        report.cliOutputSha256 = sha256(cliOutput);
        report.cliFailureHttpStatuses = [...new Set([...cliOutput.matchAll(/HTTP ([45][0-9]{2})/g)]
            .map((match) => Number(match[1])))].sort();
        const failedRoute = cliOutput.match(/P0_REAL_E2E_FAILED:\s*(\/v1\/[A-Za-z0-9_/-]+): HTTP ([45][0-9]{2})/);
        report.cliFailureRoute = failedRoute?.[1] ?? null;
        report.cliFailureRouteStatus = failedRoute ? Number(failedRoute[2]) : null;
        report.cliFailureErrorCode = cliOutput.match(/P0_REAL_E2E_FAILED:[^\n]{0,2000}"(?:code|errorCode)":"([A-Z0-9_]{1,64})"/)?.[1] ?? null;
        report.cliFailureMarker = [
            'Isolated daemon did not start',
            'Isolated daemon did not register a Codex dispatch RPC',
            'Public Project approval run did not return a run ID',
            'Finish report was not persisted while server was offline',
        ].find((marker) => cliOutput.includes(`P0_REAL_E2E_FAILED: ${marker}`)) ?? null;
        report.cliFailureWordPrefix = cliOutput.match(/P0_REAL_E2E_FAILED:\s*([A-Za-z ]{4,80})/)?.[1]?.trim() ?? null;
        if ((managedOwnerCancel || managedInflightCancel) && typeof report.ownerCancelRunId === 'string') {
            const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
            try {
                const run = await fixture.orchestratorRun.findUnique({
                    where: { id: report.ownerCancelRunId as string },
                    include: { tasks: true, executions: true },
                });
                const terminationLine = cliOutput.split('\n').find((line) =>
                    line.startsWith('{"result":"ACTUAL_PROVIDER_TERMINATION_PASS"'));
                const termination = terminationLine ? JSON.parse(terminationLine) : null;
                report.ownerCancel = { helperTerminationMarker: cliOutput.includes('ACTUAL_PROVIDER_TERMINATION_DID_NOT_COMPLETE_TASK'),
                    helperExactFileAbsentAndOriginalPid: termination?.kind === 'cancelled'
                        && termination?.executionCount === 1
                        && termination?.providerProcessObserved === true
                        && termination?.providerProcessExited === true
                        && termination?.worktreeClean === true
                        && termination?.lateFinishAndRetryAbsent === true,
                    runStatus: run?.status ?? null, taskStatus: run?.tasks[0]?.status ?? null,
                    executionCount: run?.executions.length ?? 0,
                    totalRunCount: await fixture.orchestratorRun.count(),
                    totalExecutionCount: await fixture.orchestratorExecution.count(),
                    newCommitBeyondBase: Boolean(run?.tasks.some((task) => task.commitSha
                        && task.commitSha !== task.baseCommit)),
                };
            } finally { await fixture.$disconnect(); }
        }
        report.durableQueueObserved = cliOutput.includes('OFFLINE_QUEUED');
        report.daemonKilledAfterQueue = cliOutput.includes('OFFLINE_DAEMON_KILLED');
        report.cliFailurePhase = cliExit === 0 ? null
            : cliOutput.includes('did not register a Codex dispatch RPC') ? 'machine_registration'
                : cliOutput.includes('Public Project') ? 'public_project'
                    : cliOutput.includes('finish queue') ? 'durable_finish'
                        : cliOutput.includes('Committed file content mismatch') ? 'git_bytes'
                            : cliOutput.includes('P0_REAL_E2E_FAILED:') ? 'cli_e2e_other'
                                : 'cli_process_or_timeout';
        report.actualDaemon = cliOutput.includes('P0_TEST_HOME=') && cliExit === 0;
        report.runId = pass?.runId ?? null;
        report.taskId = pass?.taskId ?? null;
        report.commit = pass?.commit ?? null;
        report.committedBytes = pass?.bytes ?? null;
        report.runStatus = pass?.runStatus ?? null;
        report.localProject = pass?.mode === (daemonFinishRestart ? 'offline-finish' : 'content');
        if (oldServerRootInput && !genericOldServer) {
            const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
            try {
                const [projects, runs, executions] = await Promise.all([
                    fixture.aiProject.count(), fixture.orchestratorRun.count(),
                    fixture.orchestratorExecution.count(),
                ]);
                report.oldServerAiRejection = { projectRouteStatus: report.cliFailureRoute === '/v1/ai-team/projects'
                    ? report.cliFailureRouteStatus : null, projects, runs, executions,
                    failClosed: report.cliFailureRoute === '/v1/ai-team/projects'
                        && report.cliFailureRouteStatus === 404 && projects === 0 && runs === 0
                        && executions === 0 };
                report.aiDispatchUpgrade = aiDispatchUpgradeOracle({ schedulerAttemptObserved: false,
                    coordinatorPresent: false, workItemAbsent: true, errorCode: null,
                    providerStarted: false, retryCount: 0, sideEffectCount: 0 });
            } finally { await fixture.$disconnect(); }
        }
        if (!pass && (publishedGeneric || genericOldServer)) {
            const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
            try {
                const observed = await fixture.orchestratorRun.findFirst({
                    orderBy: { createdAt: 'desc' }, include: { tasks: true, executions: true },
                });
                const task = observed?.tasks[0];
                const execution = observed?.executions[0];
                const workItemCount = observed ? await fixture.aiWorkItem.count({
                    where: { orchestratorRunId: observed.id } }) : 0;
                const skillSnapshotCount = task ? await fixture.aiTaskSkillSnapshot.count({
                    where: { taskId: task.id } }) : 0;
                report.failedGenericRun = observed ? { runId: observed.id, runStatus: observed.status,
                    taskId: task?.id ?? null, taskStatus: task?.status ?? null,
                    taskErrorCode: task?.errorCode ?? null,
                    taskErrorMessageSha256: task?.errorMessage ? sha256(task.errorMessage) : null,
                    taskErrorHttpStatus: task?.errorMessage?.match(/(?:HTTP |status code )([45][0-9]{2})/)?.[1] ?? null,
                    taskErrorRoute: task?.errorMessage?.match(/\/v1\/[A-Za-z0-9_/-]{1,160}/)?.[0] ?? null,
                    executionId: execution?.id ?? null, executionStatus: execution?.status ?? null,
                    executionErrorCode: execution?.errorCode ?? null,
                    commitShaPresent: Boolean(task?.commitSha),
                    finalResponsePresent: Boolean(execution?.finalResponse),
                    finalResponseRuntimePattern: typeof execution?.finalResponse === 'string'
                        && /tokens used|you are (an|the) (ai|assistant)|codex (v|cli)|HAPPY_ORCH_PROMPT_B64/i.test(execution.finalResponse),
                    outputPresent: Boolean(task?.outputText),
                    runtimeTextPattern: typeof task?.outputText === 'string'
                        && /tokens used|you are (an|the) (ai|assistant)|codex (v|cli)|HAPPY_ORCH_PROMPT_B64/i.test(task.outputText),
                    persistedIdentityFlags: { assignedAgentIdPresent: Boolean(task?.assignedAgentId),
                        parentTaskIdPresent: Boolean(task?.parentTaskId),
                        capabilityProtocolVersion: execution?.capabilityProtocolVersion ?? null,
                        capabilityAllowedOpsCount: execution?.capabilityAllowedOps.length ?? 0,
                        workItemPresent: workItemCount > 0, skillSnapshotPresent: skillSnapshotCount > 0,
                        source: 'database snapshot; dispatch RPC payload not intercepted' },
                } : null;
                if (observed) report.genericDelivery = genericDeliveryOracle({
                    runStatus: observed.status, taskStatus: task?.status ?? null,
                    executionStatus: execution?.status ?? null, finishedAt: execution?.finishedAt ?? null,
                    answer: execution?.finalResponse ?? task?.finalResponse ?? task?.outputText ?? null,
                    commitSha: execution?.commitSha ?? task?.commitSha ?? null, helperPassed: false });
            } finally { await fixture.$disconnect(); }
        }
        if (typeof pass?.runId === 'string') {
            const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
            try {
                const run = await fixture.orchestratorRun.findUnique({ where: { id: pass.runId },
                    include: { tasks: true, executions: true } });
                const execution = run?.executions.find((item) => item.taskId === pass.taskId);
                const events = execution ? await fixture.aiPersistentExecutionEvent.count({
                    where: { executionId: execution.id } }) : 0;
                const usage = execution ? await fixture.aiUsageDelta.count({
                    where: { executionId: execution.id } }) : 0;
                report.executionId = execution?.id ?? null;
                report.ownedRunCount = await fixture.orchestratorRun.count();
                report.ownedExecutionCount = await fixture.orchestratorExecution.count();
                report.ownedProjectCount = await fixture.aiProject.count();
                report.taskExecutionAttempts = run?.executions.filter((item) => item.taskId === pass.taskId).length ?? 0;
                report.runTaskCount = run?.tasks.length ?? 0;
                report.executionStatus = execution?.status ?? null;
                report.taskStatus = run?.tasks.find((item) => item.id === pass.taskId)?.status ?? null;
                report.capabilityProtocolVersion = execution?.capabilityProtocolVersion ?? null;
                report.capabilityAllowedOpsCount = execution?.capabilityAllowedOps.length ?? 0;
                report.persistedCommitMatches = Boolean(execution?.commitSha && execution.commitSha === pass.commit);
                report.persistedFinalResponse = Boolean(execution?.finalResponse);
                if (publishedGeneric || genericOldServer) report.genericDelivery = genericDeliveryOracle({
                    runStatus: run?.status ?? null,
                    taskStatus: run?.tasks.find((item) => item.id === pass.taskId)?.status ?? null,
                    executionStatus: execution?.status ?? null, finishedAt: execution?.finishedAt ?? null,
                    answer: execution?.finalResponse ?? run?.tasks.find((item) => item.id === pass.taskId)?.finalResponse ?? null,
                    commitSha: execution?.commitSha ?? null, helperPassed: true });
                report.eventCount = events;
                report.usageCount = usage;
            } finally { await fixture.$disconnect(); }
            const cliRequire = createRequire(join(runtimeRoot, 'packages/happy-cli/package.json'));
            const nacl = cliRequire('tweetnacl');
            const keypair = nacl.sign.keyPair();
            const challenge = nacl.randomBytes(32);
            const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64');
            const foreignAuth = await fetch(`http://127.0.0.1:${apiB}/v1/auth`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ publicKey: b64(keypair.publicKey), challenge: b64(challenge),
                    signature: b64(nacl.sign.detached(challenge, keypair.secretKey)) }),
                signal: AbortSignal.timeout(5000),
            });
            assert.equal(foreignAuth.status, 200, 'Owned second account authentication failed');
            const foreignToken = (await foreignAuth.json() as { token: string }).token;
            const foreignGet = async (path: string) => {
                const response = await fetch(`http://127.0.0.1:${apiB}${path}`, {
                    headers: { Authorization: `Bearer ${foreignToken}` }, signal: AbortSignal.timeout(5000),
                });
                await response.arrayBuffer();
                return response.status;
            };
            report.foreignRunStatus = await foreignGet(`/v1/orchestrator/runs/${pass.runId}`);
            report.foreignEventStatus = typeof report.executionId === 'string'
                ? await foreignGet(`/v1/ai-team/executions/${report.executionId}/events?limit=1`) : null;
        }
        report.result = expectOldServerAiRejection
            ? (report.oldServerAiRejection as any)?.failClosed === true ? 'passed' : 'failed'
            : managedOwnerCancel || managedInflightCancel
            ? cliExit === 0 && (report.ownerCancel as any)?.helperTerminationMarker === true
                && (report.ownerCancel as any)?.helperExactFileAbsentAndOriginalPid === true
                && (report.ownerCancel as any)?.runStatus === 'cancelled'
                && (report.ownerCancel as any)?.taskStatus === 'cancelled'
                && (report.ownerCancel as any)?.executionCount === 1
                && (report.ownerCancel as any)?.totalRunCount === 1
                && (report.ownerCancel as any)?.totalExecutionCount === 1
                && (report.ownerCancel as any)?.newCommitBeyondBase === false
                && (report.ownerSwitch as any)?.instanceChanged === true
                && (report.ownerSwitch as any)?.epochAdvanced === true
                && (!managedInflightCancel || ((report.ownerSwitch as any)?.actualDaemonAckHeld === true
                    && (report.ownerSwitch as any)?.bridgeRequestMatched === true
                    && (report.ownerSwitch as any)?.oldAckRejected === true)) ? 'passed' : 'failed'
            : cliExit === 0 && report.localProject === true
            && (!daemonFinishRestart || (report.durableQueueObserved === true
                && report.daemonKilledAfterQueue === true))
            && report.executionStatus === 'completed' && report.taskStatus === 'completed'
            && report.persistedCommitMatches === true && report.persistedFinalResponse === true
            && report.taskExecutionAttempts === 1 && report.runTaskCount === 1
            && report.ownedRunCount === 1 && report.ownedExecutionCount === 1
            && report.foreignRunStatus === 404 && report.foreignEventStatus === 404
            && (publishedGeneric || genericOldServer || (Number(report.capabilityProtocolVersion) >= 1
                && Number(report.capabilityAllowedOpsCount) > 0
                && Number(report.eventCount) > 0 && Number(report.usageCount) > 0))
            && (!managedRedisPause || ((report.redisPause as any)?.firstStatus === 503
                && (report.redisPause as any)?.retryAfterPresent === true
                && (report.redisPause as any)?.firstErrorCode === 'AI_RPC_BRIDGE_UNAVAILABLE'
                && (report.redisPause as any)?.runsAfterFirstFailure === 0
                && (report.redisPause as any)?.projectsAfterFirstFailure === 0
                && report.ownedProjectCount === 1
                && [200, 201].includes((report.redisPause as any)?.retryStatus)))
            && (!managedOwnerSwitch || ((report.ownerSwitch as any)?.instanceChanged === true
                && (report.ownerSwitch as any)?.epochAdvanced === true))
            ? 'passed' : 'failed';
    } catch (error) {
        report.failureKind = error instanceof Error ? error.name : 'UnknownError';
        report.result = 'failed';
    } finally {
        for (const observer of bridgeObservers) observer.disconnect();
        if (redisPaused) {
            spawnSync('docker', ['unpause', redisContainer], { timeout: 10_000 });
            redisPaused = false;
        }
        if (proxy) await new Promise<void>((done) => proxy!.close(() => done()));
        for (const child of children.reverse()) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        }
        await Promise.all(children.map((child) => new Promise<void>((done) => {
            if (child.exitCode !== null || child.signalCode !== null) return done();
            const timeout = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
            child.once('exit', () => { clearTimeout(timeout); done(); });
        })));
        for (const entry of readdirSync(ownedTemp)) {
            if (!/^happy-p0-cli-real-[A-Za-z0-9_-]+$/.test(entry)) continue;
            const statePath = join(ownedTemp, entry, 'happy-home', 'daemon.state.json');
            if (!existsSync(statePath)) continue;
            try {
                const state = JSON.parse(readFileSync(statePath, 'utf8'));
                if (Number.isSafeInteger(state.pid) && state.pid > 0) {
                    const home = join(ownedTemp, entry, 'happy-home');
                    const inherited = readFileSync(`/proc/${state.pid}/environ`);
                    if (inherited.includes(Buffer.from(`HAPPY_HOME_DIR=${home}\0`)))
                        process.kill(state.pid, 'SIGTERM');
                }
            } catch { /* Owned daemon may already have exited. */ }
        }
        rmSync(ownedTemp, { recursive: true, force: true });
        if (created) {
            const fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
            try { ownedMachines = await fixture.machine.findMany({ select: { id: true, accountId: true } }); }
            finally { await fixture.$disconnect(); }
        }
        let redisRemoved = 0;
        if (process.env.REDIS_URL && ownedMachines.length) {
            const Redis = require('ioredis');
            const client = new Redis(process.env.REDIS_URL);
            try {
                const cliSource = readFileSync(join(runtimeRoot, 'packages/happy-cli/src/api/apiMachine.ts'), 'utf8');
                const suffixes = [...cliSource.matchAll(/registerHandler\('([^']+)'/g)]
                    .map((match) => match[1]);
                for (const machine of ownedMachines) for (const suffix of suffixes) {
                    const method = `${machine.id}:${suffix}`;
                    const routeId = sha256(`${machine.accountId}\0${method}`);
                    const routeKey = `happy:rpc:route:v1:${routeId}`;
                    const epochKey = `happy:rpc:epoch:v1:${routeId}`;
                    const route = await client.get(routeKey);
                    if (route) {
                        const parsed = JSON.parse(route);
                        assert.equal(parsed.accountId, machine.accountId);
                        assert.equal(parsed.method, method);
                    }
                    redisRemoved += await client.del(routeKey, epochKey);
                }
            } finally { client.disconnect(); }
        }
        let residual = -1;
        if (created) {
            await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
            const rows = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
                'SELECT count(*)::bigint AS count FROM pg_database WHERE datname=$1', name);
            residual = Number(rows[0].count);
        }
        await admin.$disconnect();
        report.fixtureCleanup = { databases: created ? 1 : 0, residual,
            homeRemoved: !existsSync(ownedTemp),
            machines: ownedMachines.length, exactRedisKeysRemoved: redisRemoved };
        if (redisStarted) {
            const stopped = spawnSync('docker', ['rm', '-f', redisContainer],
                { encoding: 'utf8', timeout: 15_000 });
            assert.equal(stopped.status, 0, 'Owned Redis container cleanup failed');
            (report.fixtureCleanup as Record<string, unknown>).redisContainerRemoved = true;
        }
        if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
        else delete process.env.REDIS_URL;
        report.candidateAfterSha256 = candidateDigest();
        report.candidateStable = report.candidateBeforeSha256 === report.candidateAfterSha256;
        if (publishedOldRootInput) {
            report.oldPublishedCliAfter = verifyPublishedNpmTree(
                (oldProvenance as { packageRoot: string }).packageRoot, runtimeRoot);
            report.oldPublishedCliStable = (report.oldPublishedCliAfter as any).packedTreeSha256
                === (oldProvenance as any).packedTreeSha256
                && (report.oldPublishedCliAfter as any).generatedLockSha256
                    === (oldProvenance as any).generatedLockSha256;
            if (!report.oldPublishedCliStable) report.candidateStable = false;
        }
        if (oldServerTrackedBefore) {
            report.oldServerTrackedAfter = verifyOldServerTrackedTree(
                oldServerTrackedBefore.oldRoot, oldRevision!, root);
            report.oldServerTrackedStable = (report.oldServerTrackedAfter as any).trackedTreeSha256
                === oldServerTrackedBefore.trackedTreeSha256;
            if (!report.oldServerTrackedStable) report.candidateStable = false;
        }
        if (currentCliEntry) {
            const bundleStable = sha256(readFileSync(currentCliEntry)) === effectiveCliSha256
                && currentCliTree().sha256 === effectiveCliTreeSha256
                && sha256(readFileSync(effectiveBuildReport!)) === currentCliBuild?.reportSha256;
            (report.currentCliBundle as Record<string, unknown>).stable = bundleStable;
            if (!bundleStable) report.candidateStable = false;
        }
        if (!report.candidateStable && report.result === 'passed') report.result = 'unknown';
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ managedDiagnostic: report.result, cliExitCode: report.cliExitCode,
            cliFailurePhase: report.cliFailurePhase,
            runId: report.runId, taskId: report.taskId, committedBytes: report.committedBytes,
            executionStatus: report.executionStatus, taskStatus: report.taskStatus,
            capabilityProtocolVersion: report.capabilityProtocolVersion,
            eventCount: report.eventCount, usageCount: report.usageCount,
            foreignRunStatus: report.foreignRunStatus, foreignEventStatus: report.foreignEventStatus,
            candidateStable: report.candidateStable, fixtureCleanup: report.fixtureCleanup,
            reportSha256: sha256(readFileSync(reportPath)) }));
    }
    if (report.result !== 'passed' || (report.fixtureCleanup as { residual: number }).residual !== 0)
        process.exitCode = 1;
}

async function runSocketBoundaryDiagnostic(reportPath: string) {
    if (argv.length !== 2 || existsSync(reportPath))
        throw new Error('Usage: --socket-boundary-diagnostic NEW_REPORT_PATH');
    const configured = process.env.DATABASE_URL;
    if (!configured) throw new Error('DATABASE_URL is required');
    const tag = randomBytes(8).toString('hex');
    const name = `happy_ai_compat_${tag}`;
    const databaseUrl = new URL(configured); databaseUrl.pathname = `/${name}`;
    databaseUrl.searchParams.set('connection_limit', '2');
    const adminUrl = new URL(configured); adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    const ownedTemp = mkdtempSync(join(tmpdir(), 'ai-team-socket-boundary-'));
    chmodSync(ownedTemp, 0o700);
    const container = `ai-team-redis-${tag}`;
    const redisPort = await reservePort();
    const redisUrl = `redis://127.0.0.1:${redisPort}`;
    const children: Array<ReturnType<typeof spawn>> = [];
    const report: Record<string, unknown> = { format: 'happy-ai-team-socket-boundary-v1',
        scope: 'real-socket-api-machine-client-fixture-no-daemon', candidateBeforeSha256: candidateDigest(),
        artifactContextSha256, sourceRoot: root, runtimeRoot,
        result: 'failed' };
    let created = false;
    let fixture: InstanceType<typeof PrismaClient> | null = null;
    let redisStarted = false;
    let redisPaused = false;
    try {
        const image = 'sha256:487efc0616382465781b8fdc3d6d1db449e6fd80ae23bf48432a2da6b6929908';
        const started = spawnSync('docker', ['run', '--pull=never', '--rm', '-d', '--name', container,
            '--label', `happy.ai-team.fixture=${tag}`, '--network', 'host', image,
            'redis-server', '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '',
            '--appendonly', 'no'], { encoding: 'utf8', timeout: 15_000 });
        assert.equal(started.status, 0, 'Owned Redis container did not start');
        redisStarted = true;
        const Redis = require('ioredis');
        const probe = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
        try {
            const began = Date.now(); let ready = false;
            while (Date.now() - began < 10_000) {
                try { ready = await probe.ping() === 'PONG'; if (ready) break; }
                catch { await new Promise((done) => setTimeout(done, 100)); }
            }
            assert.equal(ready, true, 'Owned Redis did not become ready');
        } finally { probe.disconnect(); }
        assert.match(name, /^happy_ai_compat_[0-9a-f]{16}$/);
        await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
        const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
            cwd: join(runtimeRoot, 'packages/happy-server'),
            env: { ...process.env, DATABASE_URL: databaseUrl.toString(), REDIS_URL: redisUrl },
            encoding: 'utf8', timeout: 180_000, maxBuffer: 2_000_000 });
        assert.equal(migrated.status, 0, 'Owned database migration failed');
        fixture = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
        const account = await fixture.account.create({ data: { publicKey: `socket-boundary-${tag}` } });
        const machineId = `machine-${tag}`;
        await fixture.machine.create({ data: { id: machineId, accountId: account.id,
            metadata: 'fixture-encrypted-metadata', dataEncryptionKey: randomBytes(32) } });
        const run = await fixture.orchestratorRun.create({ data: { accountId: account.id,
            title: 'Socket boundary fixture', status: 'running', tasks: { create: {
                seq: 1, taskKey: 'socket', provider: 'codex', prompt: 'Socket fixture', status: 'running' } } },
        include: { tasks: true } });
        const execution = await fixture.orchestratorExecution.create({ data: {
            runId: run.id, taskId: run.tasks[0].id, machineId, provider: 'codex',
            status: 'running', dispatchToken: randomUUID() } });
        process.env.DATABASE_URL = databaseUrl.toString();
        const { auth } = await importRuntime('packages/happy-server/sources/app/auth/auth');
        await auth.init();
        const socketToken = await auth.createToken(account.id);
        const commonEnv = { ...process.env, DATABASE_URL: databaseUrl.toString(), REDIS_URL: redisUrl,
            AI_COMPAT_FIXTURE_ROOT: runtimeRoot, AI_COMPAT_ACCOUNT: account.id,
            AI_COMPAT_TOKEN: randomBytes(24).toString('hex'), AI_COMPAT_SOCKET_TOKEN: socketToken,
            AI_COMPAT_MACHINE: machineId, AI_COMPAT_EXECUTION: execution.id,
            AI_COMPAT_RUN: run.id, AI_COMPAT_TASK: run.tasks[0].id,
            AI_COMPAT_DISPATCH: execution.dispatchToken, HAPPY_HOME_DIR: ownedTemp };
        const tsx = join(runtimeRoot, 'node_modules/.bin/tsx');
        const launch = async (kind: 'socket-server' | 'machine', address?: string) => {
            const child = spawn(tsx, ['--tsconfig', join(runtimeRoot,
                `packages/${kind === 'machine' ? 'happy-cli' : 'happy-server'}/tsconfig.json`),
            fileURLToPath(import.meta.url), kind === 'machine' ? '--machine-child' : '--socket-server-child',
            'new'], { cwd: runtimeRoot, env: { ...commonEnv, ...(address ? { HAPPY_SERVER_URL: address } : {}) },
                stdio: ['ignore', 'pipe', 'pipe'] });
            children.push(child);
            let output = ''; let errors = '';
            child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
            child.stdout?.on('data', (chunk: string) => { output += chunk; });
            child.stderr?.on('data', (chunk: string) => { errors += chunk; });
            const marker = kind === 'machine' ? 'AI_COMPAT_MACHINE_CONNECTING' : 'AI_COMPAT_SOCKET_READY ';
            const began = Date.now();
            while (!output.includes(marker) && Date.now() - began < 15_000 && child.exitCode === null)
                await new Promise((done) => setTimeout(done, 50));
            assert.ok(output.includes(marker), `${kind} unavailable stderrSha256=${sha256(errors)}`);
            return { child, output: () => output, address: output.match(/AI_COMPAT_SOCKET_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1] };
        };
        const serverA = await launch('socket-server');
        const serverB = await launch('socket-server');
        assert.ok(serverA.address && serverB.address);
        const original = await launch('machine', serverA.address);
        const rpc = async (server: string, action: string, timeout = 10_000) => {
            const response = await fetch(`${server}/fixture/rpc`, { method: 'POST',
                headers: { Authorization: `Bearer ${commonEnv.AI_COMPAT_TOKEN}`,
                    'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
                signal: AbortSignal.timeout(timeout) });
            return { status: response.status, body: await response.json() as { reason?: string; result?: { accepted?: boolean } } };
        };
        const registeredAt = Date.now();
        while (!original.output().includes('AI_COMPAT_MACHINE_RPC_REGISTERED')
            && Date.now() - registeredAt < 10_000)
            await new Promise((done) => setTimeout(done, 50));
        assert.ok(original.output().includes('AI_COMPAT_MACHINE_RPC_REGISTERED'));
        const remote = await rpc(serverB.address, 'dispatch');
        report.remoteBeforeSwitch = remote.status;
        const delayed = rpc(serverA.address, 'delayed-dispatch');
        const enteredAt = Date.now();
        while (!original.output().includes('AI_COMPAT_SOCKET_OLD_ACK_STARTED')
            && Date.now() - enteredAt < 2000) await new Promise((done) => setTimeout(done, 25));
        assert.ok(original.output().includes('AI_COMPAT_SOCKET_OLD_ACK_STARTED'));
        const replacement = await launch('machine', serverB.address);
        const replacementAt = Date.now();
        while (!replacement.output().includes('AI_COMPAT_MACHINE_RPC_REGISTERED')
            && Date.now() - replacementAt < 10_000) await new Promise((done) => setTimeout(done, 50));
        const registeredBeforeOldAck = replacement.output().includes('AI_COMPAT_MACHINE_RPC_REGISTERED')
            && !original.output().includes('AI_COMPAT_SOCKET_OLD_ACK_RETURNED');
        const oldAck = await delayed;
        report.registeredBeforeOldAck = registeredBeforeOldAck;
        report.oldAckStatus = oldAck.status;
        report.oldAckReason = oldAck.body.reason ?? null;
        original.child.kill('SIGTERM');
        if (original.child.exitCode === null && original.child.signalCode === null)
            await new Promise<void>((done) => original.child.once('exit', () => done()));
        const afterOldDisconnect = await rpc(serverA.address, 'dispatch');
        report.afterOldDisconnectStatus = afterOldDisconnect.status;
        await new Promise((done) => setTimeout(done, 31_000));
        const afterTtl = await rpc(serverA.address, 'dispatch');
        report.afterTtlStatus = afterTtl.status;
        const paused = spawnSync('docker', ['pause', container], { timeout: 10_000 });
        assert.equal(paused.status, 0, 'Owned Redis pause failed'); redisPaused = true;
        try {
            let outageStatus = 0;
            try { outageStatus = (await rpc(serverA.address, 'dispatch', 2500)).status; }
            catch { outageStatus = 0; }
            report.redisOfflineStatus = outageStatus;
        } finally {
            const unpaused = spawnSync('docker', ['unpause', container], { timeout: 10_000 });
            assert.equal(unpaused.status, 0, 'Owned Redis unpause failed'); redisPaused = false;
        }
        const restoredAt = Date.now(); let recoveredStatus = 0;
        while (Date.now() - restoredAt < 15_000) {
            try { recoveredStatus = (await rpc(serverA.address, 'dispatch')).status; }
            catch { recoveredStatus = 0; }
            if (recoveredStatus === 200) break;
            await new Promise((done) => setTimeout(done, 300));
        }
        report.redisRecoveredStatus = recoveredStatus;
        report.result = remote.status === 200 && registeredBeforeOldAck
            && oldAck.status === 503 && oldAck.body.reason === 'owner_changed'
            && afterOldDisconnect.status === 200 && afterTtl.status === 200
            && report.redisOfflineStatus === 503 && recoveredStatus === 200 ? 'passed' : 'failed';
    } catch (error) {
        report.failureKind = error instanceof Error ? error.name : 'UnknownError';
        report.result = 'failed';
    } finally {
        if (redisPaused) spawnSync('docker', ['unpause', container], { stdio: 'ignore', timeout: 10_000 });
        for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGTERM');
        await Promise.all(children.map((child) => new Promise<void>((done) => {
            if (child.exitCode !== null || child.signalCode !== null) return done();
            const timeout = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
            child.once('exit', () => { clearTimeout(timeout); done(); });
        })));
        await fixture?.$disconnect();
        if (created) {
            await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
            const rows = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
                'SELECT count(*)::bigint AS count FROM pg_database WHERE datname=$1', name);
            report.databaseResidual = Number(rows[0].count);
        }
        await admin.$disconnect();
        if (redisStarted) {
            spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 15_000 });
            const inspected = spawnSync('docker', ['inspect', container],
                { stdio: 'ignore', timeout: 10_000 });
            report.ownedRedisRemoved = inspected.status !== 0;
        }
        rmSync(ownedTemp, { recursive: true, force: true });
        report.ownedTempRemoved = !existsSync(ownedTemp);
        report.candidateAfterSha256 = candidateDigest();
        report.candidateStable = report.candidateBeforeSha256 === report.candidateAfterSha256;
        if (!report.candidateStable && report.result === 'passed') report.result = 'unknown';
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ socketBoundary: report.result,
            remoteBeforeSwitch: report.remoteBeforeSwitch, oldAckStatus: report.oldAckStatus,
            oldAckReason: report.oldAckReason, afterOldDisconnectStatus: report.afterOldDisconnectStatus,
            afterTtlStatus: report.afterTtlStatus, redisOfflineStatus: report.redisOfflineStatus,
            redisRecoveredStatus: report.redisRecoveredStatus, candidateStable: report.candidateStable,
            databaseResidual: report.databaseResidual, ownedRedisRemoved: report.ownedRedisRemoved,
            reportSha256: sha256(readFileSync(reportPath)) }));
    }
    if (report.result !== 'passed' || report.databaseResidual !== 0
        || report.ownedRedisRemoved !== true || report.ownedTempRemoved !== true)
        process.exitCode = 1;
}

if (argv.includes('--api-only-child')) {
    const [{ db }, { redis }, { initEncrypt }, { initGithub }, { loadFiles },
        { auth }, { startApi }] = await Promise.all([
        importRuntime('packages/happy-server/sources/storage/db'),
        importRuntime('packages/happy-server/sources/storage/redis'),
        importRuntime('packages/happy-server/sources/modules/encrypt'),
        importRuntime('packages/happy-server/sources/modules/github'),
        importRuntime('packages/happy-server/sources/storage/files'),
        importRuntime('packages/happy-server/sources/app/auth/auth'),
        importRuntime('packages/happy-server/sources/app/api/api'),
    ]);
    await db.$connect();
    await redis.ping();
    await initEncrypt();
    await initGithub();
    await loadFiles();
    await auth.init();
    await startApi();
    process.stdout.write('AI_COMPAT_PRODUCTION_API_SOCKET_ONLY_READY\n');
    process.once('SIGTERM', () => { void db.$disconnect().finally(() => {
        redis.disconnect(); process.exit(0);
    }); });
} else if (schedulerTicksChild) {
    if (argv.length !== 2 || !/^[a-z0-9_-]{10,80}$/i.test(schedulerTicksChild))
        throw new Error('Invalid owned scheduler account ID');
    const { orchestratorSchedulerTick } = await importRuntime('packages/happy-server/sources/app/orchestrator/scheduler');
    const { db } = await importRuntime('packages/happy-server/sources/storage/db');
    try {
        for (let i = 0; i < 4; i++) await orchestratorSchedulerTick(new Date(), schedulerTicksChild);
        console.log('AI_COMPAT_FOUR_SCHEDULER_TICKS_OK');
    } finally { await db.$disconnect(); }
} else if (selfTestOracles) {
    if (argv.length !== 1) throw new Error('Usage: --self-test-oracles');
    assert.deepEqual(classifyNotFoundResponse('POST', '/v1/ai-team/executions/e/capabilities', 404,
        Buffer.from('{"error":"Not found","path":"/v1/ai-team/executions/e/capabilities","method":"POST"}')),
    { shape: 'legacy_custom_not_found', pathMatches: true, methodMatches: true });
    assert.equal(classifyNotFoundResponse('POST', '/v1/ai-team/executions/e/capabilities', 404,
        Buffer.from('{"statusCode":404,"error":"Not Found","message":"Route POST:/v1/ai-team/executions/e/capabilities not found"}')).shape,
    'fastify_default_not_found');
    assert.equal(classifyNotFoundResponse('POST', '/v1/x', 404,
        Buffer.from('{"error":"Not found","path":"/v1/other","method":"POST","authorization":"secret"}')).shape,
    'other');
    assert.deepEqual(genericDeliveryOracle({ runStatus: 'completed', taskStatus: 'completed',
        executionStatus: 'completed', finishedAt: new Date(), answer: 'tokens used',
        commitSha: null, helperPassed: false }),
    { processCompleted: true, durableFinish: true, answerCandidatePassesLeakScreen: false,
        trustedAnswerVerified: false, deliveryVerified: false });
    assert.equal(genericDeliveryOracle({ runStatus: 'completed', taskStatus: 'completed',
        executionStatus: 'completed', finishedAt: new Date(), answer: 'Done',
        commitSha: 'a'.repeat(40), helperPassed: true }).deliveryVerified, true);
    assert.equal(aiDispatchUpgradeOracle({ schedulerAttemptObserved: false, coordinatorPresent: false,
        workItemAbsent: true, errorCode: null, providerStarted: false,
        retryCount: 0, sideEffectCount: 0 }).verified, false);
    assert.equal(aiDispatchUpgradeOracle({ schedulerAttemptObserved: true, coordinatorPresent: true,
        workItemAbsent: true, errorCode: 'UPGRADE_REQUIRED', providerStarted: false,
        retryCount: 0, sideEffectCount: 0 }).verified, true);
    console.log('AI_TEAM_COMPAT_ORACLES_OK legacy404=classified default404=classified leakedAnswer=rejected');
} else if (verifyPublishedOldRootInput) {
    if (argv.length !== 2) throw new Error('Usage: --verify-published-old-root ISOLATED_NPM_PACKAGE');
    console.log(JSON.stringify({ format: 'happy-ai-team-published-old-v1',
        ...await verifyPublishedOldRoot(verifyPublishedOldRootInput) }));
} else if (verifyOldRoot) {
    if (!oldRevision || argv.length !== 4) throw new Error('Usage: --old-revision FULL_SHA --verify-old-root ISOLATED_BUILT_ROOT');
    console.log(JSON.stringify({ format: 'happy-ai-team-isolated-old-build-v1',
        ...verifyIsolatedOldRoot(verifyOldRoot, oldRevision) }));
} else if (oldSourceProvenance) {
    inspectOldSourceProvenance(oldSourceProvenance);
} else if (socketBoundaryDiagnostic) {
    await runSocketBoundaryDiagnostic(socketBoundaryDiagnostic);
} else if (oldClientAiUpgradeProbe) {
    await runOldClientAiUpgradeProbe(oldClientAiUpgradeProbe);
} else if (managedDiagnostic) {
    await runManagedDiagnostic(managedDiagnostic);
} else if (verifyReportDir) {
    if (argv.length !== 2 || !verifyReportDir) throw new Error('Usage: --verify-report DIRECTORY');
    let valid = false;
    try {
        const matrix = JSON.parse(readFileSync(join(verifyReportDir, 'matrix.json'), 'utf8'));
        const log = readFileSync(join(verifyReportDir, 'harness-log.json'));
        const expected = ['old-cli-new-server', 'new-cli-old-server'];
        valid = matrix.format === 'happy-ai-team-compatibility-harness-v1'
            && matrix.artifactContextSha256 === artifactContextSha256
            && matrix.candidateStable === true
            && matrix.rpc === 'verified-daemon'
            && matrix.candidateSha256 === matrix.candidateAfterSha256
            && matrix.candidateSha256 === candidateDigest()
            && matrix.harnessSha256 === sha256(readFileSync(fileURLToPath(import.meta.url)))
            && matrix.logSha256 === sha256(log)
            && expected.every((check) => matrix.results?.some((item: any) =>
                item.check === check && item.result === 'passed'))
            && expected.every((check) => {
                const report = JSON.parse(readFileSync(join(verifyReportDir, `${check}.json`), 'utf8'));
                return report.check === check && report.result === 'passed'
                    && report.candidateSha256 === matrix.candidateSha256
                    && report.artifactContextSha256 === artifactContextSha256
                    && report.logSha256 === matrix.logSha256
                    && report.matrixSha256 === sha256(readFileSync(join(verifyReportDir, 'matrix.json')));
            });
    } catch { valid = false; }
    console.log(JSON.stringify({ compatibilityReportValid: valid }));
    if (!valid) process.exitCode = 1;
} else if (childMode) {
    const sourceRoot = childMode === 'old' ? fixtureRoot : runtimeRoot;
    if (!sourceRoot) throw new Error('Fixture source root is missing');
    if (argv.includes('--server-child') || argv.includes('--socket-server-child')) {
        const socketMode = argv.includes('--socket-server-child');
        const fastify = require('fastify');
        const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
        const pino = require('pino');
        const safeError = (error: any) => ({
            kind: typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
                ? error.name.slice(0, 40) : 'UnknownError',
            code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
                ? error.code : 'UNCLASSIFIED',
            frames: typeof error?.stack === 'string'
                ? error.stack.split('\n').slice(1, 4).map((line: string) => {
                    const match = line.match(/([^/\\\s()]+\.(?:ts|js|mjs)):(\d+):(\d+)/);
                    return match ? `${match[1]}:${match[2]}` : 'unknown';
                }) : [],
        });
        const logger = pino({ level: 'error', serializers: { err: safeError } }, {
            write(line: string) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.msg === 'orchestrator submit failed') {
                        process.stderr.write(`AI_COMPAT_SUBMIT_ERROR ${JSON.stringify(entry.err ?? {})}\n`);
                    }
                } catch { /* Keep fixture logs credential-free. */ }
            },
        });
        const app = fastify({ loggerInstance: logger });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.addHook('onError', async (request: any, _reply: any, error: any) => {
            const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
                ? error.name.slice(0, 40) : 'UnknownError';
            const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
                ? error.code : 'UNCLASSIFIED';
            const frames = typeof error?.stack === 'string'
                ? error.stack.split('\n').slice(1, 4).map((line: string) => {
                    const match = line.match(/([^/\\\s()]+\.(?:ts|js|mjs)):(\d+):(\d+)/);
                    return match ? `${match[1]}:${match[2]}` : 'unknown';
                }) : [];
            const route = typeof request.routeOptions?.url === 'string'
                ? request.routeOptions.url.replace(/[^A-Za-z0-9/:_-]/g, '').slice(0, 100)
                : 'unknown';
            process.stderr.write(`AI_COMPAT_HTTP_ERROR route=${route} kind=${name} code=${code} frames=${frames.join(',')}\n`);
        });
        const fault = process.env.AI_COMPAT_FAULT;
        app.addHook('onRequest', async (request: any, reply: any) => {
            if (!request.url.startsWith('/v1/ai-team/executions/')) return;
            const capability = request.url.endsWith('/capabilities');
            const telemetry = request.url.endsWith('/events') || request.url.endsWith('/usage-deltas');
            if (fault === 'network' && capability) {
                request.raw.socket.destroy();
                return reply;
            }
            const status = fault === 'expired-capability' ? telemetry ? 409 : 200
                : capability && fault === '404-business' ? 404
                    : capability && ['401', '403', '500'].includes(fault ?? '') ? Number(fault) : null;
            if (status !== null) {
                process.stdout.write(`AI_COMPAT_FAULT_HTTP ${fault} ${status}\n`);
                return reply.code(status).send(status === 200 ? { token: 'a'.repeat(64) }
                    : { error: 'Fixture telemetry rejection' });
            }
        });
        app.addHook('onResponse', async (request: any, reply: any) => {
            if (request.url.startsWith('/v1/ai-team/executions/')
                && request.url.endsWith('/capabilities')) {
                process.stdout.write(`AI_COMPAT_CAPABILITY_HTTP ${reply.statusCode}\n`);
            }
        });
        app.decorate('authenticate', async (request: any, reply: any) => {
            if (request.headers.authorization !== `Bearer ${process.env.AI_COMPAT_TOKEN}`) {
                return reply.code(401).send({ error: 'Fixture authentication required' });
            }
            request.userId = process.env.AI_COMPAT_ACCOUNT;
        });
        const rpcPath = join(sourceRoot, 'packages/happy-server/sources/app/api/socket/rpcRegistry.ts');
        const rpc = await import(pathToFileURL(rpcPath).href);
        if (socketMode) {
            const authPath = join(sourceRoot, 'packages/happy-server/sources/app/auth/auth.ts');
            const { auth } = await import(pathToFileURL(authPath).href);
            await auth.init();
            const routePath = join(sourceRoot, 'packages/happy-server/sources/app/api/routes/orchestratorRoutes.ts');
            const { orchestratorRoutes } = await import(pathToFileURL(routePath).href);
            orchestratorRoutes(app);
            app.get('/fixture/has', async (request: any, reply: any) => {
                if (request.headers.authorization !== `Bearer ${process.env.AI_COMPAT_TOKEN}`)
                    return reply.code(401).send({ error: 'Fixture authentication required' });
                return { connected: rpc.hasUserRpcMethod(process.env.AI_COMPAT_ACCOUNT,
                    `${process.env.AI_COMPAT_MACHINE}:orchestrator-dispatch`) };
            });
            app.post('/fixture/rpc', async (request: any, reply: any) => {
                if (request.headers.authorization !== `Bearer ${process.env.AI_COMPAT_TOKEN}`)
                    return reply.code(401).send({ error: 'Fixture authentication required' });
                const action = request.body?.action;
                if (!['dispatch', 'delayed-dispatch', 'cancel'].includes(action))
                    return reply.code(400).send({ error: 'Invalid action' });
                try {
                    const dispatch = action === 'dispatch' || action === 'delayed-dispatch';
                    const result = await rpc.invokeUserRpc(process.env.AI_COMPAT_ACCOUNT,
                        `${process.env.AI_COMPAT_MACHINE}:orchestrator-${dispatch ? 'dispatch' : action}`,
                        { executionId: process.env.AI_COMPAT_EXECUTION,
                            runId: process.env.AI_COMPAT_RUN, taskId: process.env.AI_COMPAT_TASK,
                            dispatchToken: process.env.AI_COMPAT_DISPATCH,
                            ...(dispatch ? { provider: 'codex', executionType: 'initial',
                                prompt: action === 'delayed-dispatch' ? 'Socket owner delay fixture'
                                    : 'Socket compatibility fixture', timeoutMs: 1000 } : {}) },
                        action === 'delayed-dispatch' ? 8000 : 2000);
                    return reply.send({ result });
                } catch (error) {
                    const detail = error instanceof Error ? error.message : '';
                    const reason = detail.includes('owner changed') ? 'owner_changed'
                        : detail.includes('timed out') ? 'timeout'
                            : detail.includes('not available') || detail.includes('No RPC listeners')
                                ? 'unavailable' : 'other';
                    return reply.code(503).send({ error: 'RPC unavailable on this instance', reason });
                }
            });
            app.post('/fixture/tick', async (request: any, reply: any) => {
                if (request.headers.authorization !== `Bearer ${process.env.AI_COMPAT_TOKEN}`)
                    return reply.code(401).send({ error: 'Fixture authentication required' });
                const schedulerPath = join(sourceRoot,
                    'packages/happy-server/sources/app/orchestrator/scheduler.ts');
                const { orchestratorSchedulerTick } = await import(pathToFileURL(schedulerPath).href);
                await orchestratorSchedulerTick(new Date(), process.env.AI_COMPAT_ACCOUNT);
                return { ticked: true };
            });
            app.post('/fixture/event', async (request: any, reply: any) => {
                if (request.headers.authorization !== `Bearer ${process.env.AI_COMPAT_TOKEN}`)
                    return reply.code(401).send({ error: 'Fixture authentication required' });
                const eventPath = join(sourceRoot, 'packages/happy-server/sources/app/events/eventRouter.ts');
                const { eventRouter } = await import(pathToFileURL(eventPath).href);
                const delivery = eventRouter.emitEphemeral({ userId: process.env.AI_COMPAT_ACCOUNT!,
                    payload: { type: 'fixture-compat-event', marker: request.body?.marker } as any,
                    recipientFilter: { type: 'user-scoped-only' } });
                return { delivered: delivery.total };
            });
            const address = await app.listen({ host: '127.0.0.1', port: 0 });
            const socketPath = join(sourceRoot, 'packages/happy-server/sources/app/api/socket.ts');
            const { startSocket } = await import(pathToFileURL(socketPath).href);
            startSocket(app);
            const { eventRouter } = await import(pathToFileURL(join(sourceRoot,
                'packages/happy-server/sources/app/events/eventRouter.ts')).href);
            if (typeof eventRouter.startDistributed === 'function') await eventRouter.startDistributed();
            if (typeof rpc.enableDistributedRpc === 'function') {
                const bridge = await import(pathToFileURL(join(sourceRoot,
                    'packages/happy-server/sources/app/api/socket/rpcBridge.ts')).href);
                await bridge.startRpcBridge();
            }
            process.stdout.write(`AI_COMPAT_SOCKET_READY ${address}\n`);
            process.once('SIGTERM', () => { void (async () => {
                await app.close();
                if (typeof rpc.stopDistributedRpc === 'function') await rpc.stopDistributedRpc();
                eventRouter.stopDistributed?.();
                process.exit(0);
            })().catch(() => process.exit(1)); });
        } else {
        const modulePath = join(sourceRoot, 'packages/happy-server/sources/app/api/routes/orchestratorRoutes.ts');
        const { orchestratorRoutes } = await import(pathToFileURL(modulePath).href);
        orchestratorRoutes(app);
        const method = 'fixture-machine:orchestrator-dispatch';
        const params = { executionId: process.env.AI_COMPAT_EXECUTION, dispatchToken: process.env.AI_COMPAT_DISPATCH };
        rpc.getOrCreateUserRpcListeners(process.env.AI_COMPAT_ACCOUNT).set(method, {
            connected: true, timeout: () => ({ emitWithAck: async (event: string, body: any) => {
                assert.equal(event, 'rpc-request');
                assert.equal(body.method, method);
                assert.deepEqual(body.params, params);
                return { accepted: true, executionId: params.executionId };
            } }),
        });
        const rpcResult = await rpc.invokeUserRpc(process.env.AI_COMPAT_ACCOUNT, method, params, 1000);
        assert.deepEqual(rpcResult, { accepted: true, executionId: params.executionId });
        rpc.getOrCreateUserRpcListeners(process.env.AI_COMPAT_ACCOUNT).delete(method);
        const address = await app.listen({ host: '127.0.0.1', port: 0 });
        process.stdout.write('AI_COMPAT_RPC_REGISTRY_FIXTURE_OK\n');
        process.stdout.write(`AI_COMPAT_READY ${address}\n`);
        process.once('SIGTERM', () => { void app.close().finally(() => process.exit(0)); });
        }
    } else if (argv.includes('--machine-child')) {
        const modulePath = join(sourceRoot, 'packages/happy-cli/src/api/apiMachine.ts');
        const { ApiMachineClient } = await import(pathToFileURL(modulePath).href);
        const machine = { id: process.env.AI_COMPAT_MACHINE!, encryptionKey: randomBytes(32),
            encryptionVariant: 'dataKey', metadata: { host: 'fixture', platform: 'linux',
                happyCliVersion: 'fixture', homeDir: fixtureRoot ?? '/tmp',
                happyHomeDir: process.env.HAPPY_HOME_DIR!, happyLibDir: '/tmp' },
            metadataVersion: 0, daemonState: null, daemonStateVersion: 0 };
        const client = new ApiMachineClient(process.env.AI_COMPAT_SOCKET_TOKEN!, machine as any);
        client.setRPCHandlers({
            structuredModel: async () => ({ success: false, error: 'No provider in fixture' }),
            spawnSession: async () => { throw new Error('No session in fixture'); },
            stopSession: () => false, requestShutdown: () => undefined,
            orchestratorDispatch: async (params: any) => {
                if (params.prompt === 'Socket owner delay fixture') {
                    process.stdout.write('AI_COMPAT_SOCKET_OLD_ACK_STARTED\n');
                    await new Promise((done) => setTimeout(done, 5000));
                    process.stdout.write('AI_COMPAT_SOCKET_OLD_ACK_RETURNED\n');
                    return { accepted: true };
                }
                if (params.runId === process.env.AI_COMPAT_RUN) {
                    assert.equal(params.executionId, process.env.AI_COMPAT_EXECUTION);
                    assert.equal(params.dispatchToken, process.env.AI_COMPAT_DISPATCH);
                    process.stdout.write('AI_COMPAT_SOCKET_DISPATCH_ACK\n');
                } else {
                    const valid = params.provider === 'codex'
                        && params.prompt === 'Socket scheduler fixture'
                        && Boolean(params.executionId && params.dispatchToken && params.taskId);
                    if (!valid) {
                        process.stdout.write(`AI_COMPAT_SOCKET_SCHEDULER_INVALID provider=${params.provider === 'codex'} prompt=${params.prompt === 'Socket scheduler fixture'} ids=${Boolean(params.executionId && params.dispatchToken && params.taskId)}\n`);
                        return { accepted: false };
                    }
                    process.stdout.write('AI_COMPAT_SOCKET_SCHEDULER_ACK\n');
                }
                return { accepted: true };
            },
            orchestratorCancel: async (params: any) => {
                assert.equal(params.executionId, process.env.AI_COMPAT_EXECUTION);
                assert.equal(params.dispatchToken, process.env.AI_COMPAT_DISPATCH);
                process.stdout.write('AI_COMPAT_SOCKET_CANCEL_ACK\n');
                return { accepted: true };
            },
            orchestratorSteer: async () => ({ accepted: false }),
            orchestratorDecision: async () => ({ accepted: false }),
            orchestratorVerifyIntegration: () => ({ verified: false, errorCode: 'FIXTURE_NO_GIT' }),
        });
        client.connect();
        (client as any).socket.on('connect', () => process.stdout.write('AI_COMPAT_MACHINE_SOCKET_CONNECTED\n'));
        (client as any).socket.on('connect_error', () => process.stdout.write('AI_COMPAT_MACHINE_SOCKET_ERROR\n'));
        (client as any).socket.on('rpc-registered', () => process.stdout.write('AI_COMPAT_MACHINE_RPC_REGISTERED\n'));
        (client as any).socket.on('rpc-error', (body: any) => process.stdout.write(
            `AI_COMPAT_MACHINE_RPC_ERROR type=${typeof body?.type === 'string' ? body.type.slice(0, 32) : 'unknown'}\n`));
        process.stdout.write('AI_COMPAT_MACHINE_CONNECTING\n');
        process.once('SIGTERM', () => { client.shutdown(); process.exit(0); });
    } else {
        const modulePath = join(sourceRoot, 'packages/happy-cli/src/api/api.ts');
        const { ApiClient } = await import(pathToFileURL(modulePath).href);
        const client = await ApiClient.create({ token: process.env.AI_COMPAT_TOKEN } as any);
        const testCase = process.env.AI_COMPAT_CASE ?? 'canonical';
        if (testCase === 'queue-init' || testCase === 'queue-replay') {
            const orchestrator = join(sourceRoot, 'packages/happy-cli/src/orchestrator');
            const finish = await import(pathToFileURL(join(orchestrator, 'finishQueue.ts')).href);
            const events = await import(pathToFileURL(join(orchestrator, 'eventQueue.ts')).href);
            const usage = await import(pathToFileURL(join(orchestrator, 'usageQueue.ts')).href);
            const queueRoot = join(process.env.HAPPY_HOME_DIR!, 'compat-finish');
            const eventRoot = join(queueRoot, 'events');
            const usageRoot = join(queueRoot, 'usage');
            const executionId = process.env.AI_COMPAT_EXECUTION!;
            if (testCase === 'queue-init') {
                await usage.enqueueUsage(usageRoot, { executionId, machineId: 'fixture-machine',
                    sourceEventId: `${executionId}:usage:1`, provider: 'codex', model: 'default',
                    inputTokens: 1, outputTokens: 1, costMicros: null, pricingVersion: null,
                    measuredAt: new Date().toISOString() });
                await events.enqueueEvent(eventRoot, { executionId, machineId: 'fixture-machine',
                    eventId: `${executionId}:finish`, seq: 1, kind: 'status', phase: 'finished',
                    occurredAt: new Date().toISOString(), summary: 'Fixture execution finished' });
                await finish.enqueueFinish(queueRoot, { executionId,
                    dispatchToken: process.env.AI_COMPAT_DISPATCH!, status: 'completed',
                    finishedAt: new Date().toISOString(), exitCode: 0,
                    outputText: 'compatibility-owned-final-response',
                    finalResponse: 'compatibility-owned-final-response' });
            }
            const statusCodes: number[] = [];
            const noteError = (_file: string, error: any) => { statusCodes.push(error?.response?.status ?? 0); };
            const telemetry = await import(pathToFileURL(join(orchestrator, 'flushTelemetry.ts')).href);
            let finishSent = false;
            let finishStatus: string | null = null;
            await telemetry.flushTelemetryAndFinishes(queueRoot, {
                reportUsageDelta: (item: any) => client.reportUsageDelta(item),
                reportExecutionEvent: (item: any) => client.reportExecutionEvent(item),
                reportOrchestratorExecutionFinish: async (report: any) => {
                    finishSent = true;
                    finishStatus = report.status;
                    await client.reportOrchestratorExecutionFinish(report);
                },
            }, (_queue: string, file: string, error: unknown) => noteError(file, error));
            const queued = (path: string) => readdirSync(path).filter((name) => name.endsWith('.json')).length;
            const retained = (needle: string): boolean => {
                const visit = (directory: string): boolean => readdirSync(directory, { withFileTypes: true })
                    .some((entry) => entry.isDirectory() ? visit(join(directory, entry.name))
                        : entry.isFile() && entry.name.endsWith('.json')
                            && readFileSync(join(directory, entry.name), 'utf8').includes(needle));
                return visit(queueRoot);
            };
            const state = { testCase, statusCodes: statusCodes.sort(), finishSent, finishStatus,
                finishFiles: queued(queueRoot), eventFiles: queued(eventRoot), usageFiles: queued(usageRoot),
                usageRetained: retained(`${executionId}:usage:1`),
                eventRetained: retained(`${executionId}:finish`) };
            process.stdout.write(`AI_COMPAT_QUEUE_STATE ${JSON.stringify(state)}\n`);
            process.exit(0);
        }
        const finalText = 'compatibility-owned-final-response';
        const payload = { executionId: process.env.AI_COMPAT_EXECUTION!,
            dispatchToken: process.env.AI_COMPAT_DISPATCH!, status: 'completed' as const,
            finishedAt: new Date().toISOString(), exitCode: 0,
            ...(testCase !== 'final-only' ? { outputText: finalText } : {}),
            ...(childMode === 'new' ? { finalResponse: finalText } : {}) };
        await client.reportOrchestratorExecutionFinish(payload);
        await client.reportOrchestratorExecutionFinish(payload);
        let wrongTokenRejected = false;
        try { await client.reportOrchestratorExecutionFinish({ ...payload, dispatchToken: randomUUID() }); }
        catch (error: any) { wrongTokenRejected = error?.response?.status === 409; }
        assert.equal(wrongTokenRejected, true, 'Wrong dispatch token was accepted');
        process.stdout.write('AI_COMPAT_CLI_FINISH_OK duplicate=accepted wrongToken=rejected\n');
    }
} else {
    if (!oldRevision || !/^[0-9a-f]{40}$/.test(oldRevision) || !reportDir || !oldRootInput
        || argv.some((arg) => arg.startsWith('--') && !['--old-revision', '--old-root', '--report-dir'].includes(arg))) {
        throw new Error('Usage: --old-revision FULL_SHA --old-root ISOLATED_BUILT_ROOT --report-dir NEW_DIRECTORY');
    }
    const configured = process.env.DATABASE_URL;
    if (!configured) throw new Error('DATABASE_URL is required');
    const baseUrl = new URL(configured);
    if (!['postgres:', 'postgresql:'].includes(baseUrl.protocol)) throw new Error('PostgreSQL URL is required');
    if (existsSync(reportDir)) throw new Error('Report directory already exists');
    mkdirSync(reportDir, { mode: 0o700 });
    const temporary = mkdtempSync(join(tmpdir(), 'ai-team-compat-'));
    const oldProvenance = verifyIsolatedOldRoot(oldRootInput, oldRevision);
    const archiveRoot = oldProvenance.oldRoot;
    const tag = randomBytes(8).toString('hex');
    const databaseName = `happy_ai_compat_${tag}`;
    const databaseUrl = new URL(baseUrl);
    databaseUrl.pathname = `/${databaseName}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    let fixtureDb: InstanceType<typeof PrismaClient> | null = null;
    let createdDatabase = false;
    let accountIdForRedisCleanup: string | null = null;
    let machineIdForRedisCleanup: string | null = null;
    const run = (command: string, args: string[], options: Record<string, unknown> = {}) => {
        const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180_000,
            maxBuffer: 16_000_000, ...options });
        if (result.status !== 0) throw new Error(`${command} failed, exit ${result.status ?? 'signal'}`);
        return result;
    };
    const before = candidateDigest();
    const daemonSource = readFileSync(join(runtimeRoot, 'packages/happy-cli/src/daemon/run.ts'), 'utf8');
    const flushPath = daemonSource.match(/const retryFinishes = async \(\) => \{([\s\S]*?)\n    \};/)?.[1] ?? '';
    assert.match(flushPath, /flushTelemetryAndFinishes\(finishQueueRoot, api/);
    const helperSource = readFileSync(join(runtimeRoot, 'packages/happy-cli/src/orchestrator/flushTelemetry.ts'), 'utf8');
    assert.match(helperSource, /flushUsage\(usage/);
    assert.match(helperSource, /flushEvents\(events/);
    assert.match(helperSource, /flushFinishes\(root/);
    assert.match(helperSource, /pendingEvents\.has\(eventIdentityHash\(report\.executionId\)\)/);
    assert.match(helperSource, /pendingUsage\.has\(eventIdentityHash\(report\.executionId\)\)/);
    assert.ok(helperSource.indexOf('flushUsage(') < helperSource.indexOf('flushEvents(')
        && helperSource.indexOf('flushEvents(') < helperSource.indexOf('flushFinishes('),
    'Daemon telemetry helper order changed; update the fixture to match the actual path');
    const logs: Array<Record<string, unknown>> = [];
    const results: Array<{ check: string; scope: string; exitCode: number;
        result: string; reason?: string }> = [];
    try {
        const revision = run('git', ['rev-parse', '--verify', `${oldRevision}^{commit}`], { cwd: root }).stdout.trim();
        assert.equal(revision, oldRevision);
        const oldCliVersion = JSON.parse(run('git', ['show', `${oldRevision}:packages/happy-cli/package.json`],
            { cwd: root }).stdout).version;
        const oldServerVersion = JSON.parse(run('git', ['show', `${oldRevision}:packages/happy-server/package.json`],
            { cwd: root }).stdout).version;
        const newCliVersion = JSON.parse(readFileSync(join(runtimeRoot, 'packages/happy-cli/package.json'), 'utf8')).version;
        const newServerVersion = JSON.parse(readFileSync(join(runtimeRoot, 'packages/happy-server/package.json'), 'utf8')).version;
        await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
        createdDatabase = true;
        const migrationDb = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
        let oldMigrationCount = 0;
        let currentMigrationCount = 0;
        let migrationEvidence: Record<string, unknown> = {};
        try {
            const oldDeploy = run('npx', ['prisma', 'migrate', 'deploy', '--schema',
                join(archiveRoot, 'packages/happy-server/prisma/schema.prisma')], {
                cwd: join(runtimeRoot, 'packages/happy-server'),
                env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            });
            const oldRows = await migrationDb.$queryRawUnsafe<Array<{ count: bigint }>>(
                'SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
            oldMigrationCount = Number(oldRows[0]?.count ?? 0n);
            assert.ok(oldMigrationCount > 0, 'Old migrations did not apply');
        const currentDeploy = run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
            cwd: join(runtimeRoot, 'packages/happy-server'),
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
        });
            const currentRows = await migrationDb.$queryRawUnsafe<Array<{ count: bigint }>>(
                'SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
            currentMigrationCount = Number(currentRows[0]?.count ?? 0n);
            assert.ok(currentMigrationCount > oldMigrationCount,
                'Current migrations did not extend the old schema');
            const status = run('npx', ['prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'], {
                cwd: join(runtimeRoot, 'packages/happy-server'),
                env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            });
            migrationEvidence = { oldMigrationCount, currentMigrationCount,
                oldDeployExit: 0, currentDeployExit: 0, statusExit: 0,
                oldDeployLogSha256: sha256(oldDeploy.stdout + oldDeploy.stderr),
                currentDeployLogSha256: sha256(currentDeploy.stdout + currentDeploy.stderr),
                statusLogSha256: sha256(status.stdout + status.stderr) };
            process.stdout.write(`AI_COMPAT_MIGRATION_UPGRADE old=${oldMigrationCount} current=${currentMigrationCount}\n`);
        } finally { await migrationDb.$disconnect(); }
        results.push({ check: 'old-schema-to-current-migrations', scope: 'isolated-prisma-migrate-deploy-status',
            exitCode: 0, result: 'passed' });
        logs.push({ check: 'old-schema-to-current-migrations', ...migrationEvidence });
        fixtureDb = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
        const account = await fixtureDb.account.create({ data: { publicKey: `ai-team-compat-${tag}` } });
        accountIdForRedisCleanup = account.id;
        const token = randomBytes(24).toString('hex');
        for (const scenario of [
            { check: 'old-cli-new-server', cli: 'old', server: 'new', testCase: 'canonical' },
            { check: 'new-cli-old-server-canonical', cli: 'new', server: 'old', testCase: 'canonical' },
            { check: 'new-cli-old-server-final-only', cli: 'new', server: 'old', testCase: 'final-only' },
            { check: 'new-cli-old-server-telemetry-queue', cli: 'new', server: 'old', testCase: 'queue-init', fault: '' },
            ...['401', '403', '404-business', '500', 'network', 'expired-capability'].map((fault) => ({
                check: `new-cli-telemetry-${fault}`, cli: 'new', server: 'new', testCase: 'queue-init', fault,
            })),
        ]) {
            const runRow = await fixtureDb.orchestratorRun.create({ data: {
                accountId: account.id, title: `compat-${scenario.check}`, status: 'running',
                tasks: { create: { seq: 1, taskKey: 'fixture', provider: 'codex',
                    prompt: 'fixture', status: 'running' } },
            }, include: { tasks: true } });
            const dispatchToken = randomUUID();
            const execution = await fixtureDb.orchestratorExecution.create({ data: {
                runId: runRow.id, taskId: runRow.tasks[0].id, machineId: `machine-${tag}`,
                provider: 'codex', status: 'running', dispatchToken,
            } });
            const source = scenario.server === 'old' ? archiveRoot : runtimeRoot;
            const childEnv = { ...process.env, DATABASE_URL: databaseUrl.toString(),
                AI_COMPAT_FIXTURE_ROOT: archiveRoot, AI_COMPAT_ACCOUNT: account.id,
                AI_COMPAT_TOKEN: token, AI_COMPAT_EXECUTION: execution.id,
                AI_COMPAT_DISPATCH: dispatchToken,
                AI_COMPAT_FAULT: 'fault' in scenario ? scenario.fault : '',
                HAPPY_HOME_DIR: join(temporary, `home-${scenario.check}`) };
            const tsx = join(runtimeRoot, 'node_modules/.bin/tsx');
            const server = spawn(tsx, ['--tsconfig', join(source, 'packages/happy-server/tsconfig.json'),
                fileURLToPath(import.meta.url), '--server-child', scenario.server],
            { cwd: runtimeRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
            let serverOutput = ''; let serverErrors = '';
            server.stdout.setEncoding('utf8'); server.stderr.setEncoding('utf8');
            server.stdout.on('data', (chunk: string) => { serverOutput += chunk; });
            server.stderr.on('data', (chunk: string) => { serverErrors += chunk; });
            try {
                const started = Date.now();
                while (!serverOutput.includes('AI_COMPAT_READY ')) {
                    if (server.exitCode !== null || Date.now() - started > 30_000) {
                        const knownError = serverErrors.match(/ERR_[A-Z_]+|MODULE_NOT_FOUND|PrismaClientInitializationError|P100[0-9]/)?.[0] ?? 'UNCLASSIFIED';
                        throw new Error(`Server child unavailable (${scenario.server}); exit=${server.exitCode ?? 'timeout'}; code=${knownError}; stderrSha256=${sha256(serverErrors)}`);
                    }
                    await new Promise((done) => setTimeout(done, 50));
                }
                const address = serverOutput.match(/AI_COMPAT_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (!address) throw new Error('Invalid fixture server address');
                const cliEnv = { ...childEnv, HAPPY_SERVER_URL: address };
                delete cliEnv.DATABASE_URL;
                cliEnv.AI_COMPAT_CASE = scenario.testCase;
                const cliSource = scenario.cli === 'old' ? archiveRoot : runtimeRoot;
                const cliArgs = ['--tsconfig', join(cliSource, 'packages/happy-cli/tsconfig.json'),
                    fileURLToPath(import.meta.url), '--cli-child', scenario.cli];
                const cli = spawnSync(tsx, cliArgs,
                    { cwd: runtimeRoot, env: cliEnv, encoding: 'utf8', timeout: 45_000, maxBuffer: 1_000_000 });
                let replay: typeof cli | null = null;
                if (scenario.testCase === 'queue-init') {
                    replay = spawnSync(tsx, cliArgs, { cwd: runtimeRoot,
                        env: { ...cliEnv, AI_COMPAT_CASE: 'queue-replay' },
                        encoding: 'utf8', timeout: 45_000, maxBuffer: 1_000_000 });
                }
                const stored = await fixtureDb.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
                const task = await fixtureDb.orchestratorTask.findUniqueOrThrow({ where: { id: runRow.tasks[0].id } });
                const finalText = 'compatibility-owned-final-response';
                const rpcFixture = serverOutput.includes('AI_COMPAT_RPC_REGISTRY_FIXTURE_OK');
                const queueState = (output: string) => {
                    const line = output.split('\n').find((item) => item.startsWith('AI_COMPAT_QUEUE_STATE '));
                    return line ? JSON.parse(line.slice('AI_COMPAT_QUEUE_STATE '.length)) as {
                        statusCodes: number[]; finishSent: boolean; finishStatus: string | null;
                        finishFiles: number; eventFiles: number;
                        usageFiles: number; usageRetained: boolean; eventRetained: boolean;
                    } : null;
                };
                const firstQueue = scenario.testCase === 'queue-init' ? queueState(cli.stdout) : null;
                const replayQueue = replay ? queueState(replay.stdout) : null;
                const canonical = cli.status === 0 && cli.stdout.includes('AI_COMPAT_CLI_FINISH_OK')
                    && rpcFixture && stored.status === 'completed' && task.status === 'completed'
                    && stored.outputText === finalText
                    && cli.stdout.includes('duplicate=accepted wrongToken=rejected');
                const finalOnlySupported = cli.status === 0
                    && cli.stdout.includes('AI_COMPAT_CLI_FINISH_OK') && rpcFixture
                    && stored.status === 'completed' && task.status === 'completed'
                    && stored.outputText === null && stored.finalResponse === finalText;
                const queueBase = cli.status === 0 && replay?.status === 0 && rpcFixture
                    && firstQueue && replayQueue && firstQueue.usageRetained
                    && firstQueue.eventRetained && replayQueue.usageRetained
                    && replayQueue.eventRetained;
                const unsupported404 = (serverOutput.match(/AI_COMPAT_CAPABILITY_HTTP 404/g) ?? []).length >= 2;
                const queueDelivered = Boolean(queueBase && unsupported404
                    && (firstQueue.finishSent || replayQueue.finishSent)
                    && (firstQueue.finishStatus === 'failed' || replayQueue.finishStatus === 'failed')
                    && replayQueue.finishFiles === 0
                    && stored.status === 'failed' && task.status === 'failed'
                    && stored.errorCode === 'TELEMETRY_ENDPOINT_UNSUPPORTED'
                    && stored.outputText === null && stored.finalResponse === null);
                const expectedFault = 'fault' in scenario ? scenario.fault : '';
                const failureCode = expectedFault === 'network' ? 0
                    : expectedFault === 'expired-capability' ? 409
                        : expectedFault === '404-business' ? 404 : Number(expectedFault);
                const faultBlocked = Boolean(queueBase && expectedFault
                    && firstQueue.statusCodes.length === 2 && replayQueue.statusCodes.length === 2
                    && firstQueue.statusCodes.every((status) => status === failureCode)
                    && replayQueue.statusCodes.every((status) => status === failureCode)
                    && !firstQueue.finishSent && !replayQueue.finishSent
                    && replayQueue.finishFiles === 1
                    && stored.status === 'running' && task.status === 'running');
                const passed = scenario.testCase === 'canonical' ? canonical
                    : scenario.testCase === 'final-only' ? finalOnlySupported
                        : expectedFault ? faultBlocked : queueDelivered;
                const reason = scenario.testCase === 'final-only' ? 'final_response_only_unavailable'
                    : scenario.testCase === 'queue-init' ? expectedFault
                        ? 'telemetry_fault_was_not_fail_closed'
                        : 'unsupported_404_did_not_recover_durable_finish'
                        : 'canonical_finish_failed';
                logs.push({ check: scenario.check, cliExit: cli.status,
                    cliMarker: cli.stdout.includes('AI_COMPAT_CLI_FINISH_OK'),
                    cliStderrSha256: sha256(cli.stderr ?? ''), serverStderrSha256: sha256(serverErrors),
                    replayExit: replay?.status ?? null,
                    queueFirst: firstQueue, queueReplay: replayQueue,
                    unsupported404, queueDelivered, faultBlocked,
                    http: 'loopback', rpcRegistryFixture: rpcFixture,
                    executionStatus: stored.status, taskStatus: task.status,
                    outputTextPersisted: stored.outputText === finalText,
                    finalResponsePersisted: stored.finalResponse === finalText,
                    duplicateAndWrongToken: cli.stdout.includes('duplicate=accepted wrongToken=rejected') });
                results.push({ check: scenario.check,
                    scope: scenario.testCase === 'queue-init' ? 'durable-queue-with-telemetry'
                        : scenario.testCase === 'final-only' ? 'http-final-response-only'
                            : 'http-finish-canonical',
                    exitCode: passed ? 0 : 1, result: passed ? 'passed' : 'failed',
                    ...(!passed ? { reason } : {}) });
            } finally {
                server.kill('SIGTERM');
                if (server.exitCode === null && server.signalCode === null) {
                    await new Promise<void>((done) => server.once('exit', () => done()));
                }
            }
        }
        const machineId = `machine-${tag}`;
        machineIdForRedisCleanup = machineId;
        await fixtureDb.machine.create({ data: { id: machineId, accountId: account.id,
            metadata: 'fixture-encrypted-metadata', dataEncryptionKey: randomBytes(32) } });
        const { auth } = await import(pathToFileURL(join(runtimeRoot,
            'packages/happy-server/sources/app/auth/auth.ts')).href);
        await auth.init();
        const socketToken = await auth.createToken(account.id);
        for (const scenario of [
            { check: 'old-cli-new-server-socket', cli: 'old', server: 'new' },
            { check: 'new-cli-old-server-socket', cli: 'new', server: 'old' },
        ]) {
            const runRow = await fixtureDb.orchestratorRun.create({ data: {
                accountId: account.id, title: `compat-${scenario.check}`, status: 'running',
                tasks: { create: { seq: 1, taskKey: 'socket-fixture', provider: 'codex',
                    prompt: 'Socket fixture', status: 'running' } },
            }, include: { tasks: true } });
            const dispatchToken = randomUUID();
            const execution = await fixtureDb.orchestratorExecution.create({ data: {
                runId: runRow.id, taskId: runRow.tasks[0].id, machineId,
                provider: 'codex', status: 'running', dispatchToken,
            } });
            const commonEnv = { ...process.env, DATABASE_URL: databaseUrl.toString(),
                AI_COMPAT_FIXTURE_ROOT: archiveRoot, AI_COMPAT_ACCOUNT: account.id,
                AI_COMPAT_TOKEN: token, AI_COMPAT_SOCKET_TOKEN: socketToken,
                AI_COMPAT_MACHINE: machineId, AI_COMPAT_EXECUTION: execution.id,
                AI_COMPAT_RUN: runRow.id, AI_COMPAT_TASK: runRow.tasks[0].id,
                AI_COMPAT_DISPATCH: dispatchToken,
                HAPPY_HOME_DIR: join(temporary, `socket-home-${scenario.check}`) };
            const tsx = join(runtimeRoot, 'node_modules/.bin/tsx');
            const serverRoot = scenario.server === 'old' ? archiveRoot : root;
            const cliRoot = scenario.cli === 'old' ? archiveRoot : root;
            const children: Array<ReturnType<typeof spawn>> = [];
            const launch = async (mode: 'socket-server' | 'machine', variant: string,
                source: string, extraEnv: Record<string, string> = {}) => {
                const child = spawn(tsx, ['--tsconfig', join(source,
                    `packages/${mode === 'machine' ? 'happy-cli' : 'happy-server'}/tsconfig.json`),
                    fileURLToPath(import.meta.url), `--${mode}-child`, variant],
                { cwd: runtimeRoot, env: { ...commonEnv, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
                children.push(child);
                let output = ''; let errors = '';
                child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
                child.stdout.on('data', (chunk: string) => { output += chunk; });
                child.stderr.on('data', (chunk: string) => { errors += chunk; });
                const marker = mode === 'machine' ? 'AI_COMPAT_MACHINE_CONNECTING'
                    : 'AI_COMPAT_SOCKET_READY ';
                const started = Date.now();
                while (!output.includes(marker)) {
                    if (child.exitCode !== null || Date.now() - started > 30_000)
                        throw new Error(`${mode} child unavailable (${variant}), stderrSha256=${sha256(errors)}`);
                    await new Promise((done) => setTimeout(done, 50));
                }
                return { child, output: () => output, errors: () => errors,
                    address: mode === 'socket-server'
                        ? output.match(/AI_COMPAT_SOCKET_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1] : null };
            };
            try {
                const serverA = await launch('socket-server', scenario.server, serverRoot);
                assert.ok(serverA.address, 'Socket server address is unavailable');
                const serverB = scenario.server === 'new'
                    ? await launch('socket-server', scenario.server, serverRoot) : null;
                const machine = await launch('machine', scenario.cli, cliRoot,
                    { HAPPY_SERVER_URL: serverA.address });
                const request = async (address: string, route: string, action?: string) => {
                    const response = await fetch(`${address}${route}`, {
                        method: action ? 'POST' : 'GET',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        ...(action ? { body: JSON.stringify({ action }) } : {}),
                        signal: AbortSignal.timeout(action === 'delayed-dispatch' ? 10_000 : 3000),
                    });
                    return { status: response.status, body: await response.json() as any };
                };
                const started = Date.now();
                while (!(await request(serverA.address, '/fixture/has')).body.connected) {
                    if (Date.now() - started > 15_000) throw new Error(`Real machine RPC registration timed out
                        machineConnected=${machine.output().includes('AI_COMPAT_MACHINE_SOCKET_CONNECTED')}
                        machineError=${machine.output().includes('AI_COMPAT_MACHINE_SOCKET_ERROR')}
                        registrationError=${machine.output().includes('AI_COMPAT_MACHINE_RPC_ERROR')}
                        registeredAck=${machine.output().includes('AI_COMPAT_MACHINE_RPC_REGISTERED')}
                        serverConnected=${serverA.output().includes('User connected')}`);
                    await new Promise((done) => setTimeout(done, 100));
                }
                const dispatch = await request(serverA.address, '/fixture/rpc', 'dispatch');
                const cancel = await request(serverA.address, '/fixture/rpc', 'cancel');
                const remote = serverB?.address ? await request(serverB.address, '/fixture/rpc', 'dispatch') : null;
                let schedulerBoundary: { submitStatus: number; bTaskStatus: string;
                    aTaskStatus: string; bExecutions: number; aExecutions: number;
                    bMachineAck: boolean; aMachineAck: boolean } | null = null;
                if (serverB?.address) {
                    const submitResponse = await fetch(`${serverB.address}/v1/orchestrator/submit`, {
                        method: 'POST', headers: { Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: 'Socket scheduler fixture', mode: 'async',
                            tasks: [{ provider: 'codex', prompt: 'Socket scheduler fixture',
                                target: { type: 'machine_id', machineId } }] }),
                        signal: AbortSignal.timeout(3000),
                    });
                    const submitted = await submitResponse.json() as any;
                    assert.equal(submitResponse.status, 200, `Fixture public submit failed: ${serverB.errors()
                        .split('\n').filter((line) => line.startsWith('AI_COMPAT_HTTP_ERROR ')
                            || line.startsWith('AI_COMPAT_SUBMIT_ERROR '))
                        .slice(-2).join(' | ') || 'no classified onError'}`);
                    const submittedRunId = submitted?.data?.runId;
                    assert.equal(typeof submittedRunId, 'string');
                    const tickB = await fetch(`${serverB.address}/fixture/tick`, {
                        method: 'POST', headers: { Authorization: `Bearer ${token}` },
                        signal: AbortSignal.timeout(5000),
                    });
                    assert.equal(tickB.status, 200, 'Fixture B scheduler tick failed');
                    const bTask = await fixtureDb.orchestratorTask.findFirstOrThrow({ where: {
                        runId: submittedRunId } });
                    const bExecutions = await fixtureDb.orchestratorExecution.count({ where: {
                        runId: submittedRunId } });
                    let bMachineAck = machine.output().includes('AI_COMPAT_SOCKET_SCHEDULER_ACK');
                    const bAckStarted = Date.now();
                    while (!bMachineAck && Date.now() - bAckStarted < 1500) {
                        await new Promise((done) => setTimeout(done, 25));
                        bMachineAck = machine.output().includes('AI_COMPAT_SOCKET_SCHEDULER_ACK');
                    }
                    if (bExecutions === 0) {
                        const tickA = await fetch(`${serverA.address}/fixture/tick`, {
                            method: 'POST', headers: { Authorization: `Bearer ${token}` },
                            signal: AbortSignal.timeout(5000),
                        });
                        assert.equal(tickA.status, 200, 'Fixture A scheduler tick failed');
                    }
                    const aTask = await fixtureDb.orchestratorTask.findFirstOrThrow({ where: {
                        runId: submittedRunId } });
                    const aExecutions = await fixtureDb.orchestratorExecution.count({ where: {
                        runId: submittedRunId } });
                    const ackStarted = Date.now();
                    while (!machine.output().includes('AI_COMPAT_SOCKET_SCHEDULER_ACK')
                        && Date.now() - ackStarted < 1500) {
                        await new Promise((done) => setTimeout(done, 25));
                    }
                    schedulerBoundary = { submitStatus: submitResponse.status,
                        bTaskStatus: bTask.status, aTaskStatus: aTask.status,
                        bExecutions, aExecutions, bMachineAck,
                        aMachineAck: machine.output().includes('AI_COMPAT_SOCKET_SCHEDULER_ACK') };
                }
                const machineAck = machine.output().includes('AI_COMPAT_SOCKET_DISPATCH_ACK')
                    && machine.output().includes('AI_COMPAT_SOCKET_CANCEL_ACK');
                const socketPassed = dispatch.status === 200 && dispatch.body.result?.accepted === true
                    && cancel.status === 200 && cancel.body.result?.accepted === true && machineAck;
                let ownerSwitch: { replacementRegistered: boolean; newOwnerAck: boolean;
                    oldAckStatus: number; oldAckReason: string | null;
                    replacementBeforeOldAck: boolean; oldAckReturned: boolean;
                    switchedStatus: number | null; afterOldDisconnectStatus: number;
                    afterTtlStatus: number; switchedReason: string | null;
                    afterOldDisconnectReason: string | null; afterTtlReason: string | null;
                    oldDisconnectPreservedRoute: boolean;
                    ttlRenewed: boolean } | null = null;
                if (serverB?.address) {
                    const delayedOldAck = request(serverA.address, '/fixture/rpc', 'delayed-dispatch');
                    const oldStarted = Date.now();
                    while (!machine.output().includes('AI_COMPAT_SOCKET_OLD_ACK_STARTED')
                        && Date.now() - oldStarted < 2000)
                        await new Promise((done) => setTimeout(done, 25));
                    assert.equal(machine.output().includes('AI_COMPAT_SOCKET_OLD_ACK_STARTED'), true,
                        'Old owner did not enter delayed Socket RPC handler');
                    const replacement = await launch('machine', scenario.cli, cliRoot,
                        { HAPPY_SERVER_URL: serverB.address });
                    const ownerStarted = Date.now();
                    let replacementRegistered = false;
                    while (!replacementRegistered && Date.now() - ownerStarted < 15_000) {
                        replacementRegistered = (await request(serverB.address, '/fixture/has')).body.connected
                            && replacement.output().includes('AI_COMPAT_MACHINE_RPC_REGISTERED');
                        if (!replacementRegistered) await new Promise((done) => setTimeout(done, 100));
                    }
                    const replacementBeforeOldAck = replacementRegistered
                        && !machine.output().includes('AI_COMPAT_SOCKET_OLD_ACK_RETURNED');
                    const oldAck = await delayedOldAck;
                    const oldAckReturned = machine.output().includes('AI_COMPAT_SOCKET_OLD_ACK_RETURNED');
                    const switched = replacementRegistered
                        ? await request(serverA.address, '/fixture/rpc', 'dispatch') : null;
                    const newOwnerAck = switched?.status === 200
                        && switched.body.result?.accepted === true
                        && replacement.output().includes('AI_COMPAT_SOCKET_DISPATCH_ACK');
                    machine.child.kill('SIGTERM');
                    if (machine.child.exitCode === null && machine.child.signalCode === null)
                        await new Promise<void>((done) => machine.child.once('exit', () => done()));
                    const afterOldDisconnect = await request(serverA.address, '/fixture/rpc', 'dispatch');
                    const oldDisconnectPreservedRoute = afterOldDisconnect.status === 200
                        && afterOldDisconnect.body.result?.accepted === true;
                    await new Promise((done) => setTimeout(done, 31_000));
                    const afterTtl = await request(serverA.address, '/fixture/rpc', 'dispatch');
                    const ttlRenewed = afterTtl.status === 200 && afterTtl.body.result?.accepted === true;
                    ownerSwitch = { replacementRegistered, newOwnerAck,
                        oldAckStatus: oldAck.status, oldAckReason: oldAck.body.reason ?? null,
                        replacementBeforeOldAck, oldAckReturned,
                        switchedStatus: switched?.status ?? null,
                        afterOldDisconnectStatus: afterOldDisconnect.status,
                        afterTtlStatus: afterTtl.status,
                        switchedReason: switched?.body.reason ?? null,
                        afterOldDisconnectReason: afterOldDisconnect.body.reason ?? null,
                        afterTtlReason: afterTtl.body.reason ?? null,
                        oldDisconnectPreservedRoute, ttlRenewed };
                }
                results.push({ check: scenario.check, scope: 'real-socket-api-machine-rpc',
                    exitCode: socketPassed ? 0 : 1, result: socketPassed ? 'passed' : 'failed',
                    ...(!socketPassed ? { reason: 'socket_rpc_dispatch_cancel_failed' } : {}) });
                if (remote) {
                    const routed = remote.status === 200 && remote.body.result?.accepted === true;
                    results.push({ check: 'new-server-cross-instance-rpc', scope: 'real-socket-cross-instance-negative',
                        exitCode: routed ? 0 : 1, result: routed ? 'passed' : 'failed',
                        ...(!routed ? { reason: 'machine_connected_to_a_unavailable_on_b' } : {}) });
                }
                if (ownerSwitch) {
                    const preserved = ownerSwitch.replacementRegistered && ownerSwitch.newOwnerAck
                        && ownerSwitch.replacementBeforeOldAck && ownerSwitch.oldAckReturned
                        && ownerSwitch.oldAckStatus === 503 && ownerSwitch.oldAckReason === 'owner_changed'
                        && ownerSwitch.oldDisconnectPreservedRoute && ownerSwitch.ttlRenewed;
                    results.push({ check: 'new-server-cross-instance-owner-switch',
                        scope: 'real-socket-owner-epoch-disconnect-and-ttl',
                        exitCode: preserved ? 0 : 1, result: preserved ? 'passed' : 'failed',
                        ...(!preserved ? { reason: 'replacement_owner_not_durable_or_old_owner_not_fenced' } : {}) });
                }
                if (schedulerBoundary) {
                    const routed = schedulerBoundary.submitStatus === 200
                        && schedulerBoundary.bTaskStatus === 'dispatching'
                        && schedulerBoundary.bExecutions === 1
                        && schedulerBoundary.bMachineAck
                        && schedulerBoundary.aTaskStatus === 'dispatching'
                        && schedulerBoundary.aExecutions === 1;
                    results.push({ check: 'new-server-cross-instance-scheduler',
                        scope: 'public-submit-b-scheduler-a-machine-socket',
                        exitCode: routed ? 0 : 1, result: routed ? 'passed'
                            : schedulerBoundary.aMachineAck ? 'failed' : 'unknown',
                        ...(!routed ? { reason: schedulerBoundary.aMachineAck
                            ? 'b_cannot_dispatch_machine_connected_to_a'
                            : 'scheduler_cli_ack_not_observed' } : {}) });
                }
                let userScopedHijack: { registration: boolean; rejected: boolean;
                    routedToUser: boolean;
                    restoredAfterDisconnect: boolean } | null = null;
                let foreignMachineRegistration: { connected: boolean; registered: boolean;
                    rejected: boolean } | null = null;
                let crossInstanceEvent: { localDelivered: number; remoteDelivered: number;
                    localReceived: boolean; remoteReceived: boolean } | null = null;
                if (scenario.server === 'new') {
                    const { io } = require('socket.io-client');
                    const userSocket = io(serverA.address, { transports: ['websocket'],
                        path: '/v1/updates', reconnection: false,
                        auth: { token: socketToken, clientType: 'user-scoped' } });
                    try {
                        await new Promise<void>((done, reject) => {
                            const timeout = setTimeout(() => reject(new Error('User socket connect timeout')), 5000);
                            userSocket.once('connect', () => { clearTimeout(timeout); done(); });
                            userSocket.once('connect_error', () => {
                                clearTimeout(timeout); reject(new Error('User socket connection rejected'));
                            });
                        });
                        const seen = new Set<string>();
                        userSocket.on('ephemeral', (payload: any) => {
                            if (payload?.type === 'fixture-compat-event' && typeof payload.marker === 'string')
                                seen.add(payload.marker);
                        });
                        const markerA = `local-${randomUUID()}`;
                        const markerB = `remote-${randomUUID()}`;
                        const emitEvent = async (address: string, marker: string) => {
                            const response = await fetch(`${address}/fixture/event`, {
                                method: 'POST', headers: { Authorization: `Bearer ${token}`,
                                    'Content-Type': 'application/json' },
                                body: JSON.stringify({ marker }), signal: AbortSignal.timeout(3000),
                            });
                            assert.equal(response.status, 200);
                            return await response.json() as { delivered: number };
                        };
                        const localEvent = await emitEvent(serverA.address, markerA);
                        const remoteEvent = await emitEvent(serverB!.address, markerB);
                        const eventStarted = Date.now();
                        while ((!seen.has(markerA) || !seen.has(markerB))
                            && Date.now() - eventStarted < 1500) {
                            await new Promise((done) => setTimeout(done, 25));
                        }
                        crossInstanceEvent = { localDelivered: localEvent.delivered,
                            remoteDelivered: remoteEvent.delivered,
                            localReceived: seen.has(markerA), remoteReceived: seen.has(markerB) };
                        const method = `${machineId}:orchestrator-dispatch`;
                        userSocket.on('rpc-request', (_body: unknown, ack: (value: unknown) => void) => {
                            ack({ accepted: false, fixtureHijack: true });
                        });
                        const registrationPromise = new Promise<'registered' | 'rejected' | 'timeout'>((done) => {
                            const timeout = setTimeout(() => done('timeout'), 3000);
                            userSocket.once('rpc-registered', (body: any) => {
                                clearTimeout(timeout); done(body?.method === method ? 'registered' : 'rejected');
                            });
                            userSocket.once('rpc-error', () => { clearTimeout(timeout); done('rejected'); });
                        });
                        userSocket.emit('rpc-register', { method });
                        const registrationResult = await registrationPromise;
                        const hijacked = await request(serverA.address, '/fixture/rpc', 'dispatch');
                        userScopedHijack = { registration: registrationResult === 'registered',
                            rejected: registrationResult === 'rejected', restoredAfterDisconnect: false,
                            routedToUser: hijacked.status === 200
                                && hijacked.body.result?.fixtureHijack === true };
                    } finally { userSocket.close(); }
                    await new Promise((done) => setTimeout(done, 150));
                    const afterDisconnect = await request(serverA.address, '/fixture/rpc', 'dispatch');
                    userScopedHijack!.restoredAfterDisconnect = afterDisconnect.status === 200
                        && afterDisconnect.body.result?.accepted === true;
                    const guarded = userScopedHijack.rejected && !userScopedHijack.routedToUser
                        && userScopedHijack.restoredAfterDisconnect;
                    results.push({ check: 'machine-rpc-user-socket-hijack',
                        scope: 'real-socket-same-account-client-type-boundary',
                        exitCode: guarded ? 0 : 1, result: guarded ? 'passed' : 'failed',
                        ...(!guarded ? { reason: 'user_socket_registration_or_route_guard_failed' } : {}) });
                    const foreignId = `not-owned-${randomUUID()}`;
                    const foreignSocket = io(serverA.address, { transports: ['websocket'],
                        path: '/v1/updates', reconnection: false,
                        auth: { token: socketToken, clientType: 'machine-scoped', machineId: foreignId } });
                    try {
                        const connected = await new Promise<boolean>((done) => {
                            const timeout = setTimeout(() => done(false), 3000);
                            foreignSocket.once('connect', () => { clearTimeout(timeout); done(true); });
                            foreignSocket.once('connect_error', () => { clearTimeout(timeout); done(false); });
                        });
                        let registered = false;
                        let rejected = !connected;
                        if (connected) {
                            const outcome = new Promise<'registered' | 'rejected' | 'timeout'>((done) => {
                                const timeout = setTimeout(() => done('timeout'), 3000);
                                foreignSocket.once('rpc-registered', () => {
                                    clearTimeout(timeout); done('registered');
                                });
                                foreignSocket.once('rpc-error', () => {
                                    clearTimeout(timeout); done('rejected');
                                });
                            });
                            foreignSocket.emit('rpc-register', {
                                method: `${foreignId}:orchestrator-dispatch` });
                            const result = await outcome;
                            registered = result === 'registered';
                            rejected = result === 'rejected';
                        }
                        foreignMachineRegistration = { connected, registered, rejected };
                    } finally { foreignSocket.close(); }
                    results.push({ check: 'machine-rpc-ownership',
                        scope: 'real-socket-unowned-machine-id-negative',
                        exitCode: foreignMachineRegistration.rejected && !foreignMachineRegistration.registered ? 0 : 1,
                        result: foreignMachineRegistration.rejected && !foreignMachineRegistration.registered
                            ? 'passed' : 'failed',
                        ...(!foreignMachineRegistration.rejected || foreignMachineRegistration.registered
                            ? { reason: 'unowned_machine_scoped_socket_registered' } : {}) });
                    const eventRouted = crossInstanceEvent?.localReceived === true
                        && crossInstanceEvent.remoteReceived === true;
                    results.push({ check: 'new-server-cross-instance-event',
                        scope: 'real-socket-event-router', exitCode: eventRouted ? 0 : 1,
                        result: eventRouted ? 'passed' : 'failed',
                        ...(!eventRouted ? { reason: 'event_emitted_on_b_missing_for_user_socket_on_a' } : {}) });
                }
                logs.push({ check: scenario.check, socket: 'real', client: 'ApiMachineClient',
                    dispatchStatus: dispatch.status, cancelStatus: cancel.status, machineAck,
                    crossInstanceStatus: remote?.status ?? null,
                    schedulerBoundary, ownerSwitch, userScopedHijack, foreignMachineRegistration, crossInstanceEvent,
                    schedulerInvalid: machine.output().includes('AI_COMPAT_SOCKET_SCHEDULER_INVALID'),
                    schedulerRpcWarning: serverA.output().includes('Dispatch RPC failed')
                        || Boolean(serverB?.output().includes('Dispatch RPC failed')),
                    serverStderrSha256: sha256(serverA.errors()), cliStderrSha256: sha256(machine.errors()) });
            } finally {
                for (const child of children.reverse()) child.kill('SIGTERM');
                await Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
                    ? Promise.resolve() : new Promise<void>((done) => child.once('exit', () => done()))));
            }
        }
        const after = candidateDigest();
        const candidateStable = after === before;
        const publishedResults = candidateStable ? results : results.map((item) => item.result === 'passed'
            ? { ...item, exitCode: 1, result: 'unknown', reason: 'candidate_changed_during_run' }
            : item);
        const logText = `${JSON.stringify(logs, null, 2)}\n`;
        writeFileSync(join(reportDir, 'harness-log.json'), logText, { flag: 'wx', mode: 0o600 });
        const manifest = { format: 'happy-ai-team-compatibility-harness-v1',
            oldRevision, oldCliVersion, oldServerVersion,
            artifactContextSha256, sourceRoot: root, runtimeRoot,
            newGitHead: run('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
            newCliVersion, newServerVersion, candidateSha256: before,
            candidateAfterSha256: after, candidateStable,
            schema: `old migrations ${oldMigrationCount} then current migrations ${currentMigrationCount} on isolated database`,
            dependencies: oldProvenance,
            rpc: 'real Socket.IO ApiMachineClient dispatch/cancel passed; managed daemon/provider unknown',
            externalProvider: 'unknown: no provider or GitHub request',
            command: `npx dotenv -e .env.dev -- tsx --tsconfig tsconfig.json ../../scripts/verifyAiTeamCompatibilityReal.mts --old-revision ${oldRevision} --old-root ${archiveRoot} --report-dir ${reportDir}`,
            logSha256: sha256(logText), harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
            completedAt: new Date().toISOString(), results: publishedResults };
        writeFileSync(join(reportDir, 'matrix.json'), `${JSON.stringify(manifest, null, 2)}\n`,
            { flag: 'wx', mode: 0o600 });
        const matrixSha256 = sha256(readFileSync(join(reportDir, 'matrix.json')));
        for (const result of publishedResults) {
            if (result.result !== 'passed') continue;
            const report = { format: 'happy-ai-team-check-v1', candidateSha256: before,
                artifactContextSha256, sourceRoot: root, runtimeRoot,
                check: `${result.check}-http-finish`, scope: result.scope,
                exitCode: 0, result: 'passed',
                command: manifest.command, completedAt: manifest.completedAt,
                oldRevision, harnessSha256: manifest.harnessSha256,
                logFile: 'harness-log.json', logSha256: manifest.logSha256,
                matrixFile: 'matrix.json', matrixSha256 };
            writeFileSync(join(reportDir, `${result.check}-http-finish.json`), `${JSON.stringify(report, null, 2)}\n`,
                { flag: 'wx', mode: 0o600 });
        }
        console.log(JSON.stringify({ oldRevision, candidateSha256: before, candidateStable,
            results: publishedResults,
            rpc: manifest.rpc, reportDir }));
        if (!candidateStable || publishedResults.some((result) => result.result !== 'passed')) process.exitCode = 1;
    } finally {
        await fixtureDb?.$disconnect();
        if (accountIdForRedisCleanup && machineIdForRedisCleanup && process.env.REDIS_URL) {
            const Redis = require('ioredis');
            const client = new Redis(process.env.REDIS_URL);
            try {
                const cliSource = readFileSync(join(root,
                    'packages/happy-cli/src/api/apiMachine.ts'), 'utf8');
                const suffixes = [...cliSource.matchAll(/registerHandler\('([^']+)'/g)]
                    .map((match) => match[1]);
                let removed = 0;
                for (const suffix of suffixes) {
                    const method = `${machineIdForRedisCleanup}:${suffix}`;
                    const routeId = sha256(`${accountIdForRedisCleanup}\0${method}`);
                    const routeKey = `happy:rpc:route:v1:${routeId}`;
                    const epochKey = `happy:rpc:epoch:v1:${routeId}`;
                    const route = await client.get(routeKey);
                    if (route) {
                        const parsed = JSON.parse(route);
                        assert.equal(parsed.accountId, accountIdForRedisCleanup);
                        assert.equal(parsed.method, method);
                    }
                    removed += await client.del(routeKey, epochKey);
                }
                console.log(`AI_COMPAT_REDIS_FIXTURE_CLEANUP exactKeys=${suffixes.length * 2} removed=${removed}`);
            } catch {
                console.error('AI_COMPAT_REDIS_FIXTURE_CLEANUP_FAILED');
                process.exitCode = 1;
            } finally { client.disconnect(); }
        }
        if (createdDatabase) {
            if (!/^happy_ai_compat_[0-9a-f]{16}$/.test(databaseName)) throw new Error('Unsafe fixture database name');
            await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
            const remaining = await admin.$queryRaw<Array<{ count: bigint }>>`
                SELECT COUNT(*)::bigint AS count FROM pg_database WHERE datname = ${databaseName}`;
            assert.equal(remaining[0]?.count, 0n, 'Fixture database was not removed');
        }
        await admin.$disconnect();
        rmSync(temporary, { recursive: true, force: true });
        console.log(`AI_COMPAT_FIXTURE_CLEANUP databases=${createdDatabase ? 1 : 0} residual=0`);
    }
}
