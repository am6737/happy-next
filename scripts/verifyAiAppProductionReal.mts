import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import { chmodSync, lstatSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { inventoryTree } from './aiTeamProductionTree.mjs';
import { resolveProductionRuntime } from './aiTeamProductionRuntime.mjs';

// Independent commander replay of actual App/provider browser cases. Never
// use an API already bound by another task, or stop another task's processes.
const root = fileURLToPath(new URL('../', import.meta.url));
const options = process.argv.slice(2);
assert.ok(options.length === 0 || options.length === 1 && [
    '--browser-retry-only', '--include-browser-retry', '--diagnostic-fixture-only',
    '--prepare-only', '--warmup-only', '--p2-workspace', '--p2-skills',
].includes(options[0]));
const retryOnly = options.includes('--browser-retry-only');
const includeRetry = options.includes('--include-browser-retry');
const diagnosticOnly = options.includes('--diagnostic-fixture-only');
const prepareOnly = options.includes('--prepare-only');
const warmupOnly = options.includes('--warmup-only');
const p2WorkspaceOnly = options.includes('--p2-workspace');
const p2SkillsOnly = options.includes('--p2-skills');
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const contextFile = process.env.AI_TEAM_ARTIFACT_CONTEXT_FILE ?? null;
const bound = resolveProductionRuntime(root, contextFile);
const freshRoot = process.env.HAPPY_TEST_FRESH_ROOT;
if (freshRoot) {
    assert.ok(isAbsolute(freshRoot) && resolve(freshRoot) === freshRoot
        && /^\/tmp\/ai-team-frozen-deps-[A-Za-z0-9]+$/.test(freshRoot),
    'HAPPY_TEST_FRESH_ROOT must name a canonical isolated fresh root');
    assert.ok(lstatSync(freshRoot).isDirectory() && realpathSync(freshRoot) === freshRoot,
        'HAPPY_TEST_FRESH_ROOT must be a real directory');
    if (contextFile) assert.equal(freshRoot, bound.runtimeRoot,
        'HAPPY_TEST_FRESH_ROOT differs from bound artifact root');
}
const runtimeRoot = freshRoot ?? bound.runtimeRoot;
const configRoot = process.env.HAPPY_TEST_CONFIG_ROOT;
const configFiles = ['.env', 'packages/happy-server/.env', 'packages/happy-server/.env.dev'];
let loadedConfig: Record<string, string> = {};
if (configRoot) {
    assert.ok(isAbsolute(configRoot) && resolve(configRoot) === configRoot
        && lstatSync(configRoot).isDirectory() && realpathSync(configRoot) === configRoot,
    'HAPPY_TEST_CONFIG_ROOT must be a canonical real directory');
    const requireRuntime = createRequire(join(runtimeRoot, 'package.json'));
    const dotenv = requireRuntime('dotenv') as typeof import('dotenv');
    for (const name of configFiles) {
        const path = join(configRoot, name);
        assert.ok(lstatSync(path).isFile() && realpathSync(path) === path,
            `Test config must be a regular file: ${name}`);
        loadedConfig = { ...loadedConfig, ...dotenv.parse(readFileSync(path)) };
    }
}
const childEnv = { ...loadedConfig, ...process.env };
assert.ok(childEnv.DATABASE_URL && childEnv.REDIS_URL,
    'Supply HAPPY_TEST_CONFIG_ROOT or preload DATABASE_URL and REDIS_URL');
assert.ok(!/\$\{/.test(childEnv.DATABASE_URL),
    'DATABASE_URL contains unresolved interpolation');
const prepareInput = process.env.HAPPY_TEST_PREPARE_TIMEOUT_MS ?? '360000';
assert.ok(/^[1-9]\d*$/.test(prepareInput) && Number.isSafeInteger(Number(prepareInput))
    && Number(prepareInput) >= 30_000 && Number(prepareInput) <= 600_000,
    'HAPPY_TEST_PREPARE_TIMEOUT_MS must be an integer between 30000 and 600000');
const prepareTimeoutMs = Number(prepareInput);
const appRoot = join(runtimeRoot, 'packages/happy-app');
const servesFrozenWeb = runtimeRoot !== resolve(root);
if (servesFrozenWeb) {
    const webBundleDir = join(appRoot, 'dist/_expo/static/js/web');
    const hasLocalApi = readdirSync(webBundleDir).some((name) => name.endsWith('.js')
        && readFileSync(join(webBundleDir, name), 'utf8').includes('http://127.0.0.1:43105'));
    assert.ok(hasLocalApi, 'Fresh web build has no isolated API address');
}
const entry = contextFile ? join(runtimeRoot, 'packages/happy-cli/dist/index.mjs')
    : process.env.HAPPY_TEST_CLI_ENTRY;
if (contextFile) assert.ok(!['HAPPY_TEST_CLI_ENTRY', 'HAPPY_TEST_CLI_SHA256',
    'HAPPY_TEST_CLI_TREE_SHA256', 'HAPPY_TEST_CLI_FILE_COUNT']
    .some((key) => process.env[key]), 'Artifact context and explicit CLI pins are mutually exclusive');
assert.ok(entry && isAbsolute(entry) && join(dirname(entry), 'index.mjs') === entry,
    'A fixed dist/index.mjs CLI entry is required');
if (freshRoot) assert.equal(entry, join(freshRoot, 'packages/happy-cli/dist/index.mjs'),
    'Explicit fresh root and CLI entry differ');
const before = sha256(readFileSync(entry));
const dist = dirname(entry);
const treeRoot = contextFile ? runtimeRoot : dirname(dist);
const treeBefore = inventoryTree(treeRoot, dist);
const repositoryFiles = treeBefore.files.map((file) => ({
    ...file, path: contextFile ? file.path : `packages/happy-cli/${file.path}`,
}));
const legacyTreeSha256 = sha256(JSON.stringify(repositoryFiles));
const formalTreeSha256 = sha256(JSON.stringify(repositoryFiles.map((file) => ({
    path: file.path, sha256: file.sha256, mode: file.mode,
})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
const suppliedEntrySha256 = process.env.HAPPY_TEST_CLI_SHA256;
const suppliedTreeSha256 = process.env.HAPPY_TEST_CLI_TREE_SHA256;
const suppliedFileCount = process.env.HAPPY_TEST_CLI_FILE_COUNT;
if (!contextFile) {
    assert.match(suppliedEntrySha256 ?? '', /^[a-f0-9]{64}$/,
        'Explicit CLI entry SHA-256 is required');
    assert.match(suppliedTreeSha256 ?? '', /^[a-f0-9]{64}$/,
        'Explicit CLI tree SHA-256 is required');
    assert.ok(suppliedFileCount && /^[1-9]\d*$/.test(suppliedFileCount)
        && Number.isSafeInteger(Number(suppliedFileCount)), 'Explicit CLI file count is required');
    assert.equal(before, suppliedEntrySha256, 'CLI entry SHA-256 changed');
    assert.equal(treeBefore.files.length, Number(suppliedFileCount), 'CLI dist file count changed');
    assert.ok([legacyTreeSha256, formalTreeSha256].includes(suppliedTreeSha256),
        'CLI dist tree SHA-256 changed');
} else {
    assert.equal(treeBefore.sha256, bound.binding?.artifacts.cliDist.sha256,
        'Bound CLI dist tree changed');
}
const treeSha256 = suppliedTreeSha256 ?? formalTreeSha256;
const fileCount = suppliedFileCount ?? String(treeBefore.files.length);
const owned = mkdtempSync(join(tmpdir(), 'happy-app-root-')); chmodSync(owned, 0o700);
const logs = mkdtempSync(join(tmpdir(), 'happy-app-infra-logs-')); chmodSync(logs, 0o700);
const metroOverride = join(owned, 'metro-no-watchman.cjs');
writeFileSync(metroOverride, `const config = require(${JSON.stringify(join(appRoot, 'metro.config.js'))});\nconfig.resolver.useWatchman = false;\nmodule.exports = config;\n`, { mode: 0o600 });
const children: ChildProcess[] = [];
let webProxy: HttpServer | null = null;
let preparationPhase = 'initial';
let retainPreparationLogs = false;
const verifyArtifact = () => {
    assert.equal(sha256(readFileSync(entry)), before, 'CLI entry changed during App run');
    const current = inventoryTree(treeRoot, dist);
    assert.equal(current.sha256, treeBefore.sha256, 'CLI dist tree changed during App run');
    if (contextFile) {
        const again = resolveProductionRuntime(root, contextFile);
        assert.equal(again.artifactContextSha256, bound.artifactContextSha256);
        assert.equal(again.runtimeRoot, runtimeRoot);
    }
};
const prepareDeadline = Date.now() + prepareTimeoutMs;
function remainingPrepareMs() {
    const remaining = prepareDeadline - Date.now();
    if (remaining <= 0) throw new Error('Owned UI infrastructure preparation timed out');
    return remaining;
}
async function free(port: number) {
    const socket = createServer();
    await new Promise<void>((done, reject) => {
        socket.once('error', reject); socket.listen(port, '127.0.0.1', done);
    });
    await new Promise<void>(done => socket.close(() => done()));
}
async function reserveInternalPort() {
    const socket = createServer();
    await new Promise<void>((done, reject) => {
        socket.once('error', reject); socket.listen(0, '127.0.0.1', done);
    });
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((done) => socket.close(() => done()));
    return port;
}
async function startFrozenWebProxy(internalPort: number) {
    webProxy = createHttpServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const appNavigation = request.method === 'GET' && request.headers.accept?.includes('text/html')
            && pathname !== '/' && !pathname.startsWith('/v1/')
            && !/\.[A-Za-z0-9]+$/.test(pathname);
        const upstream = httpRequest({ hostname: '127.0.0.1', port: internalPort,
            method: request.method, path: appNavigation ? '/' : request.url,
            headers: { ...request.headers, host: `127.0.0.1:${internalPort}` } }, (incoming) => {
            response.writeHead(incoming.statusCode ?? 502, incoming.headers);
            incoming.pipe(response);
        });
        upstream.on('error', () => {
            if (!response.headersSent) response.writeHead(502);
            response.end();
        });
        request.pipe(upstream);
    });
    await new Promise<void>((done, reject) => {
        webProxy!.once('error', reject);
        webProxy!.listen(43106, '127.0.0.1', done);
    });
}
async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
}
async function ready(url: string, child: ChildProcess) {
    while (remainingPrepareMs() > 0) {
        try { if ((await fetch(url, { signal: AbortSignal.timeout(Math.min(1500, remainingPrepareMs())) })).ok) return; } catch { /* Own startup. */ }
        assert.equal(child.exitCode, null, 'Owned UI infrastructure exited'); await delay(1000);
    }
}
try {
    if (prepareOnly) {
        if (!servesFrozenWeb) {
            const config = (await import(metroOverride)).default;
            assert.equal(config.resolver.useWatchman, false);
        }
        const checkKeys = ['DATABASE_URL', 'REDIS_URL', 'APP_CONFIG_SENTINEL'];
        const probe = spawnSync(process.execPath, ['-e',
            `const { createHash } = require('node:crypto');
             const keys = ${JSON.stringify(checkKeys)};
             process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key) =>
                 [key, process.env[key] ? createHash('sha256').update(process.env[key]).digest('hex') : null]))));`],
        { env: childEnv, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 });
        assert.equal(probe.status, 0, 'Prepared child environment probe failed');
        const childHashes = JSON.parse(probe.stdout) as Record<string, string | null>;
        for (const key of checkKeys) assert.equal(childHashes[key], childEnv[key] ? sha256(childEnv[key]) : null,
            `Prepared child environment differs: ${key}`);
        if (process.env.HAPPY_TEST_EXPECT_SENTINEL) assert.equal(childHashes.APP_CONFIG_SENTINEL,
            sha256(process.env.HAPPY_TEST_EXPECT_SENTINEL), 'Configured sentinel was not passed to child');
        verifyArtifact();
        console.log(JSON.stringify({ result: 'APP_PREPARE_OK', runtimeSource: contextFile ? 'bound_fresh'
            : freshRoot ? 'explicit_unbound_fresh' : 'workspace',
        artifactContextSha256: bound.artifactContextSha256,
        prepareTimeoutMs, cliFileCount: treeBefore.files.length,
        webSource: servesFrozenWeb ? 'frozen_web_export' : 'workspace_metro',
        ...(!servesFrozenWeb && { metroWatchmanDisabled: true }),
        configSource: configRoot ? 'explicit_config_root' : 'preloaded_environment',
        childEnvironmentVerified: true }));
    } else {
    preparationPhase = 'port_check';
    await Promise.all([43105, 43106, 43107].map(free));
    const env = { ...childEnv, TMPDIR: owned, HAPPY_TEST_CLI_ENTRY: entry,
        HAPPY_TEST_CLI_SHA256: before, HAPPY_TEST_CLI_TREE_SHA256: treeSha256,
        HAPPY_TEST_CLI_FILE_COUNT: fileCount,
        ...(retryOnly ? { HAPPY_TEST_BROWSER_RETRY: '1' } : {}) };
    const apiLog = openSync(join(logs, 'api.log'), 'wx', 0o600);
    const api = spawn(join(runtimeRoot, 'node_modules/.bin/tsx'), ['--tsconfig', 'tsconfig.json', 'sources/main.ts'], {
        cwd: join(runtimeRoot, 'packages/happy-server'), detached: true,
        env: { ...env, PORT: '43105', METRICS_PORT: '43107' }, stdio: ['ignore', apiLog, apiLog] });
    closeSync(apiLog); children.push(api);
    const internalWebPort = servesFrozenWeb ? await reserveInternalPort() : 43106;
    if (servesFrozenWeb) await startFrozenWebProxy(internalWebPort);
    const expoLog = openSync(join(logs, 'expo.log'), 'wx', 0o600);
    const expo = spawn(join(runtimeRoot, 'node_modules/.bin/expo'), servesFrozenWeb
        ? ['serve', '--port', String(internalWebPort)]
        : ['start', '--web', '--port', '43106', '--host', 'localhost'], {
        cwd: appRoot, detached: true, env: { ...env,
            ...(!servesFrozenWeb && { EXPO_OVERRIDE_METRO_CONFIG: metroOverride }),
            EXPO_PUBLIC_HAPPY_SERVER_URL: 'http://127.0.0.1:43105',
            EXPO_NO_TELEMETRY: '1' }, stdio: ['ignore', expoLog, expoLog] });
    closeSync(expoLog); children.push(expo);
    preparationPhase = 'server_ready';
    await Promise.all([ready('http://127.0.0.1:43105/health', api),
        ready(servesFrozenWeb ? `http://127.0.0.1:${internalWebPort}`
            : 'http://localhost:43106', expo)]);
    if (servesFrozenWeb) {
        const rootPage = await fetch('http://localhost:43106');
        assert.equal(rootPage.status, 200, 'Frozen web proxy root is unavailable');
        const rootHtmlSha256 = sha256(await rootPage.text());
        for (const route of ['/settings/workspaces', '/inbox/ai/executions/probe']) {
            const page = await fetch(`http://localhost:43106${route}`, {
                headers: { accept: 'text/html' },
            });
            assert.equal(page.status, 200, `Frozen web route unavailable: ${route}`);
            assert.equal(sha256(await page.text()), rootHtmlSha256,
                `Frozen web route did not serve the App entry: ${route}`);
        }
    }
    assert.equal(expo.exitCode, null, 'Expo exited after readiness');
    assert.equal(expo.signalCode, null, 'Expo was signalled after readiness');
    // HTML readiness precedes Metro's first JS compilation. Warm the actual
    // browser bundle before the case helpers' shorter navigation deadlines.
    preparationPhase = 'browser_warmup';
    const { chromium } = await import(process.env.HAPPY_TEST_PLAYWRIGHT_MODULE
        ?? '/tmp/happy-app-p0-browser-20261007/node_modules/playwright/index.mjs');
    const warmBrowser = await chromium.launch({ headless: true,
        executablePath: process.env.HAPPY_TEST_CHROMIUM ?? chromium.executablePath(), args: ['--no-sandbox'] });
    try {
        const page = await warmBrowser.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.name));
        await page.goto('http://localhost:43106', { waitUntil: 'domcontentloaded', timeout: remainingPrepareMs() });
        await page.locator('body').getByText('Happy Next', { exact: false }).first()
            .waitFor({ timeout: remainingPrepareMs() });
        assert.equal(pageErrors.length, 0, 'Fresh App warmup had browser page errors');
    } finally { await warmBrowser.close(); }
    assert.equal(expo.exitCode, null, 'Expo exited during browser warmup');
    assert.equal(expo.signalCode, null, 'Expo was signalled during browser warmup');
    preparationPhase = 'business_cases';
    if (warmupOnly) {
        console.log(JSON.stringify({ result: 'APP_WARMUP_OK', webSource: servesFrozenWeb
            ? 'frozen_web_export' : 'workspace_metro',
        artifactContextSha256: bound.artifactContextSha256 }));
    } else {
    const cases = p2WorkspaceOnly ? [['ai-team-workspace-grants-ui-real-e2e.mjs', 'p2-workspace']]
        : p2SkillsOnly ? [['ai-team-workspace-grants-ui-real-e2e.mjs', 'p2-skills']]
        : diagnosticOnly ? [['ai-orchestrator-diagnostic-ui-fixture.mjs', 'diagnostic']]
        : retryOnly ? [['ai-team-scoped-ui-real-e2e.mjs', 'retry']] : [
        ['ai-approval-crash-ui-real-e2e.mjs', 'pending'],
        ['ai-approval-crash-ui-real-e2e.mjs', 'invoking'],
        ['ai-template-proposal-ui-real-e2e.mjs', 'accepted'],
        ['ai-template-proposal-ui-real-e2e.mjs', 'rejected'],
    ];
    if (includeRetry) cases.push(['ai-team-scoped-ui-real-e2e.mjs', 'retry']);
    for (const [script, mode] of cases) {
        const caseRetry = script === 'ai-team-scoped-ui-real-e2e.mjs';
        const caseDiagnostic = script === 'ai-orchestrator-diagnostic-ui-fixture.mjs';
        const caseP2 = mode === 'p2-workspace' || mode === 'p2-skills';
        const child = spawn(process.execPath, [`scripts/${script}`, ...(caseRetry || caseDiagnostic ? [] : [mode])], {
            cwd: appRoot, detached: true, env: { ...env,
                ...(caseRetry ? { HAPPY_TEST_BROWSER_RETRY: '1' } : {}),
                ...(mode === 'p2-workspace' ? { HAPPY_TEST_AGENT_TRIAL: '1', HAPPY_TEST_P2_NEW: '1' } : {}),
                ...(mode === 'p2-skills' ? { HAPPY_TEST_P2_SKILLS: '1' } : {}) },
            stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
        let output = '';
        const caseLog = join(logs, `case-${mode}.log`);
        const caseLogFd = openSync(caseLog, 'wx', 0o600);
        for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
            writeSync(caseLogFd, chunk);
            output = `${output}${chunk}`.slice(-200000);
        });
        const timeout = setTimeout(() => { void stop(child); }, caseP2 ? 600000 : 240000);
        const code = await new Promise<number | null>(done => child.once('close', done));
        clearTimeout(timeout); closeSync(caseLogFd);
        const records = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        const proof = records.find(record => caseDiagnostic
            ? record.fixture === true && record.rawDiagnosticHidden === true
                && record.verifiedAnswerVisibleOnlyWhenTrusted === true
                && record.deliveryNotInferred === true && record.cases === 4
            : mode === 'p2-skills' ? record.p2Skills === true && record.provider === 'real_codex'
                && record.workItemCount === 2 && record.answerVerified === true
                && record.supportHashMatched === true && record.gitClean === true
                && record.cancelPreservedBinding === true && record.unboundThroughUi === true
                && Array.isArray(record.versionsFrozen) && record.versionsFrozen.join(',') === '1,2'
            : mode === 'p2-workspace' ? record.metadataStatus === 'CAS 409 preserved browser draft'
                && record.subscribed === true && record.commentRequests === 2
            : caseRetry ? record.realProviderOutput === true && record.sameSession === true
                && record.sameWorktree === true && record.retryHttpStatus === 200
                && record.retryRequestCount === 1 && record.workItemCount === 1 && record.gitClean === true
                && record.finalAttempts === record.firstAttempts + 1
                && record.cliBundleSha256 === before && record.cliTreeSha256 === treeSha256
                : record.provider === 'real_codex' || record.provider === 'real_codex_mcp');
        const cleanup = records.find(record => record.residualAccounts === 0
            && (record.cleanup || record.publicKeysMatched === true
                || caseDiagnostic && record.publicKeyMatched === true));
        const p2WorkspaceComplete = mode !== 'p2-workspace' || (
            records.some(record => record.notificationRead === true)
            && records.some(record => record.restoredDisabled === true)
            && records.some(record => record.archiveRejectedStatus === 409)
            && records.some(record => record.rolledBackTo === 1 && record.runtimeUnchanged === true));
        if (code !== 0 || !proof || !cleanup || !p2WorkspaceComplete) {
            retainPreparationLogs = true;
            console.log(JSON.stringify({ phase: 'ROOT_APP_CASE_FAILED', script, mode,
            code, privateCaseLog: caseLog, cleanupVerified: Boolean(cleanup), browserDiagnostics: records.filter(record => record.browserPath)
                .map(record => ({ tag: record.tag, browserPath: record.browserPath })),
            failureClasses: ['PROJECT_SNAPSHOT_INVALID', 'SPAWN_ERROR',
                'Timeout', 'page.goto', 'locator.waitFor', 'Actual provider test failed', 'Provider proposal did not reach review']
                .filter(value => output.includes(value)) }));
        }
        assert.equal(code, 0, 'Independent App/provider browser case failed; raw credential-bearing logs withheld');
        assert.ok(proof && cleanup && p2WorkspaceComplete,
            'Missing expected browser case or public-key cleanup evidence');
        console.log(JSON.stringify({ result: caseDiagnostic ? 'ROOT_APP_BROWSER_RESULT_FIXTURE_OK'
            : 'ROOT_APP_REAL_BROWSER_PROVIDER_OK', script, mode,
            proof: { tag: proof.tag, provider: proof.provider, fixture: proof.fixture,
                p2Skills: proof.p2Skills, versionsFrozen: proof.versionsFrozen,
                supportHashMatched: proof.supportHashMatched, answerVerified: proof.answerVerified,
                cancelPreservedBinding: proof.cancelPreservedBinding, unboundThroughUi: proof.unboundThroughUi,
                metadataStatus: proof.metadataStatus, subscribed: proof.subscribed,
                realProviderOutput: proof.realProviderOutput, sameSession: proof.sameSession,
                sameWorktree: proof.sameWorktree, retryHttpStatus: proof.retryHttpStatus,
                retryRequestCount: proof.retryRequestCount, workItemCount: proof.workItemCount,
                gitClean: proof.gitClean, rawDiagnosticHidden: proof.rawDiagnosticHidden,
                verifiedAnswerVisibleOnlyWhenTrusted: proof.verifiedAnswerVisibleOnlyWhenTrusted,
                deliveryNotInferred: proof.deliveryNotInferred, cases: proof.cases },
            cleanup: { tag: cleanup.tag, publicKeysMatched: cleanup.publicKeysMatched,
                publicKeyMatched: cleanup.publicKeyMatched,
                residualAccounts: cleanup.residualAccounts }, fixedCliBundleSha256: before,
            artifactContextSha256: bound.artifactContextSha256,
            runtimeSource: contextFile ? 'bound_fresh' : freshRoot ? 'explicit_unbound_fresh' : 'workspace' }));
    }
    }
    }
} catch (error) {
    if (preparationPhase !== 'business_cases') {
        retainPreparationLogs = true;
        const childState = (child: ChildProcess | undefined) => child
            ? { exitCode: child.exitCode, signal: child.signalCode } : null;
        const listeners = spawnSync('ss', ['-ltnp'], { encoding: 'utf8', timeout: 3000 });
        console.error(JSON.stringify({ phase: 'APP_PREPARATION_FAILED', stage: preparationPhase,
            api: childState(children[0]), expo: childState(children[1]),
            listeners: [43105, 43106, 43107].map((port) => ({ port,
                listening: listeners.status === 0 && new RegExp(`:${port}\\b`).test(listeners.stdout) })),
            privateLogs: logs }));
    }
    throw error;
} finally {
    try {
        for (const child of [...children].reverse()) await stop(child);
    } finally {
        if (webProxy) {
            webProxy.closeAllConnections();
            await new Promise<void>((done) => webProxy!.close(() => done()));
        }
        try { verifyArtifact(); }
        finally {
            rmSync(owned, { recursive: true, force: true });
            if (!retainPreparationLogs) rmSync(logs, { recursive: true, force: true });
            console.log('ROOT_APP_INFRASTRUCTURE_OWNED_CLEANUP_COMPLETE');
        }
    }
}
