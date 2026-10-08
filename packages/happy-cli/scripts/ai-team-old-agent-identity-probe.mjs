import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createServer as createNetServer } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { verifyOldServerTrackedTree } from '../../../scripts/aiTeamOldComponentIdentity.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const configRoot = (() => {
  const selected = process.env.HAPPY_TEST_CONFIG_ROOT ?? root;
  if (!isAbsolute(selected)) throw new Error('Test configuration root must be absolute');
  try {
    const canonical = realpathSync(selected);
    if (!lstatSync(canonical).isDirectory()) throw new Error('invalid directory');
    return canonical;
  } catch { throw new Error('Test configuration directory is unavailable'); }
})();
const readTestConfig = (name) => {
  try {
    const path = join(configRoot, name);
    if (!lstatSync(path).isFile()) throw new Error('invalid file');
    return readFileSync(path);
  } catch { throw new Error('Test configuration file is unavailable'); }
};
const require = createRequire(join(root, 'packages/happy-cli/package.json'));
const { PrismaClient } = require('@prisma/client');
const nacl = require('tweetnacl');
const dotenv = require('dotenv');
const revision = '08030b85829f85f4d6db32abf28c96f8e5a52329';
const generic = process.argv.includes('--generic');
assert.ok(process.argv.slice(2).every((value) => value === '--generic' || value === '--expect-safe'), 'Unknown probe option');
const formalEntry = process.env.HAPPY_TEST_CLI_ENTRY ?? '/tmp/happy-cli-formal-root-ZrQUi5/dist/index.mjs';
const formalSha = process.env.HAPPY_TEST_CLI_SHA256
  ?? '94514dee16a6e78f596f4cc99a7ec5ebd7363c3e03a79d66106d197125726e63';
assert.match(formalSha, /^[0-9a-f]{64}$/);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 300_000,
    maxBuffer: 8_000_000, ...options });
  if (result.status !== 0) throw new Error(`${command} exit ${result.status ?? result.signal}`);
  return result.stdout;
};
const owner = mkdtempSync(join(tmpdir(), 'happy-old-agent-probe-'));
chmodSync(owner, 0o700);
const preparedRoot = process.env.HAPPY_PROBE_PREPARED_OLD_ROOT;
const oldRoot = preparedRoot ?? join(owner, 'old-source');
const home = join(owner, 'happy-home');
const codexHome = join(owner, 'codex-home');
const repo = join(owner, 'repo');
const databaseName = `happy_old_agent_${randomBytes(8).toString('hex')}`;
const children = [];
const report = { revision, formalEntrySha256: formalSha, result: 'INCOMPLETE' };
let admin, db, databaseCreated = false, accountId, machineId, redisUrl;
let healthStatus = null;
const start = (command, args, options) => {
  const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(proc);
  let output = '';
  const stages = new Set();
  for (const stream of [proc.stdout, proc.stderr]) stream?.on('data', (chunk) => {
    for (const match of String(chunk).matchAll(/OLD_AGENT_(BOOT|MODULES|DB|REDIS|AUTH|ROUTES)_READY/g))
      stages.add(match[1]);
    output = `${output}${chunk}`.slice(-20_000);
  });
  return { proc, output: () => output, stages };
};
const until = async (check, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(200);
  }
  throw new Error('Probe deadline exceeded');
};
const freePort = async () => {
  const server = createNetServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
};
try {
  const config = Object.assign({}, ...['.env', 'packages/happy-server/.env',
    'packages/happy-server/.env.dev'].map((name) => dotenv.parse(readTestConfig(name))));
  assert.equal(sha(readFileSync(formalEntry)), formalSha, 'Formal bundle changed');
  for (const path of [home, codexHome, repo]) mkdirSync(path, { mode: 0o700 });
  if (preparedRoot) {
    assert.ok(preparedRoot.startsWith('/tmp/happy-old-agent-prepared-'));
    assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: oldRoot }).trim(), revision);
    assert.equal(sha(readFileSync(join(oldRoot, 'yarn.lock'))),
      sha(run('git', ['show', `${revision}:yarn.lock`], { cwd: root })));
    assert.ok(existsSync(join(oldRoot, 'packages/happy-wire/dist/index.mjs')));
  } else {
    run('git', ['clone', '--shared', '--no-checkout', '--quiet', root, oldRoot]);
    run('git', ['checkout', '--detach', '--quiet', revision], { cwd: oldRoot });
    run('yarn', ['install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'], { cwd: oldRoot });
    run('yarn', ['build'], { cwd: join(oldRoot, 'packages/happy-wire') });
  }
  report.oldRootIdentityBefore = verifyOldServerTrackedTree(oldRoot, revision, root);
  redisUrl = config.REDIS_URL ?? process.env.REDIS_URL;
  const sourceUrl = config.DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(sourceUrl, 'Test database URL unavailable');
  const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
  const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
  admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  const serverPort = await freePort();
  const metricsPort = await freePort();
  const serverEnv = { ...process.env, ...config, DATABASE_URL: databaseUrl.toString(),
    DATABASE_POOL_SIZE: '2', PORT: String(serverPort), METRICS_PORT: String(metricsPort) };
  const prisma = join(oldRoot, 'node_modules/.bin/prisma');
  const serverCwd = join(oldRoot, 'packages/happy-server');
  run(prisma, ['generate', '--schema', 'prisma/schema.prisma'], { cwd: serverCwd, env: serverEnv });
  run(prisma, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { cwd: serverCwd, env: serverEnv });
  db = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  const git = (args) => run('git', args, { cwd: repo });
  git(['init', '-q']); git(['config', 'user.name', 'Probe']);
  git(['config', 'user.email', 'probe@example.invalid']);
  writeFileSync(join(repo, 'README.md'), 'read-only probe\n');
  git(['add', 'README.md']); git(['commit', '-qm', 'base']);
  for (const name of ['auth.json', 'config.toml']) {
    copyFileSync(join(homedir(), '.codex', name), join(codexHome, name));
    chmodSync(join(codexHome, name), 0o600);
  }
  const server = start(join(oldRoot, 'node_modules/.bin/tsx'),
    ['--tsconfig', 'tsconfig.json', join(root, 'packages/happy-cli/scripts/ai-team-old-agent-server-child.mjs')],
    { cwd: serverCwd, env: { ...serverEnv, HAPPY_OLD_AGENT_SOURCE: oldRoot,
      HAPPY_OLD_AGENT_STAGE_FILE: join(owner, 'server-stages') } });
  const base = `http://127.0.0.1:${serverPort}`;
  await until(async () => {
    if (server.proc.exitCode !== null) throw new Error(`Old Server exited ${server.proc.exitCode}`);
    if (!existsSync(join(owner, 'server-stages')) ||
      !readFileSync(join(owner, 'server-stages'), 'utf8').split('\n').includes('ROUTES')) return false;
    try {
      const response = await fetch(`${base}/probe-ready`, { signal: AbortSignal.timeout(1000) });
      healthStatus = response.status;
      return response.ok;
    } catch (error) { healthStatus = error instanceof Error ? error.name : 'UnknownError'; return false; }
  }, 120_000);
  report.healthStatus = healthStatus;
  const missingPath = '/v1/ai-team/executions/probe/capabilities';
  const missing = await fetch(`${base}${missingPath}`, { method: 'POST',
    signal: AbortSignal.timeout(10_000) });
  const missingBody = await missing.json();
  assert.equal(missing.status, 404);
  assert.deepEqual(missingBody, { error: 'Not found', path: missingPath, method: 'POST' });
  report.legacy404Shape = 'old-custom-exact';
  const keypair = nacl.sign.keyPair();
  const challenge = nacl.randomBytes(32);
  const b64 = (value) => Buffer.from(value).toString('base64');
  const auth = await fetch(`${base}/v1/auth`, { method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ publicKey: b64(keypair.publicKey), challenge: b64(challenge),
      signature: b64(nacl.sign.detached(challenge, keypair.secretKey)) }) });
  assert.equal(auth.status, 200, 'Old Server auth failed');
  const { token } = await auth.json();
  accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  writeFileSync(join(home, 'access.key'), JSON.stringify({ encryption: {
    publicKey: b64(keypair.publicKey), machineKey: b64(nacl.randomBytes(32)) }, token }), { mode: 0o600 });
  const daemon = start(process.execPath, [formalEntry, 'daemon', 'start-sync'], { cwd: repo,
    env: { ...process.env, HAPPY_HOME_DIR: home, CODEX_HOME: codexHome,
      HAPPY_SERVER_URL: base, HAPPY_DISABLE_CAFFEINATE: 'true' } });
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${path} HTTP ${response.status}`);
    return response.json();
  };
  const machine = await until(async () => {
    if (daemon.proc.exitCode !== null) throw new Error('Formal daemon exited before registration');
    const context = await request('/v1/orchestrator/context', undefined, 'GET');
    return context.data?.machines?.find((item) => item.dispatchReady && item.providers?.includes('codex'));
  });
  machineId = machine.machineId;
  assert.ok(machineId, 'Old context omitted machine identity');
  let runId, taskId;
  if (generic) {
    const submitted = await request('/v1/orchestrator/submit', {
      title: 'Generic read-only identity probe', mode: 'async', idempotencyKey: randomBytes(16).toString('hex'),
      tasks: [{ taskKey: 'read', provider: 'codex', workingDirectory: repo,
        permissionMode: 'read_only', timeoutMs: 90_000,
        prompt: 'Read README.md. Do not modify files. Answer PROBE_READ_ONLY_OK.' }],
    });
    runId = submitted.data.runId;
    const projected = await request(`/v1/orchestrator/runs/${runId}`, undefined, 'GET');
    taskId = projected.data.tasks?.[0]?.taskId;
    assert.ok(taskId);
  } else {
    const agent = await request('/v1/ai-team/agents', { name: 'Identity Probe', role: 'reader',
      description: 'Inspect the local repository only', emoji: '', skills: [], responsibilities: [],
      settings: { instructions: 'Read README.md and answer PROBE_READ_ONLY_OK.', engine: 'codex',
        model: 'default', workingDirectory: repo, permissionMode: 'read_only', allowDelegation: false }, enabled: true });
    const assignment = await request('/v1/ai-team/assignments', { agentId: agent.id,
      title: 'Read-only identity probe', summary: 'Read README.md. Do not modify files. Answer PROBE_READ_ONLY_OK.' });
    runId = assignment.runId;
    taskId = assignment.executionId;
    const runRow = await db.orchestratorRun.findUniqueOrThrow({ where: { id: runId } });
    const work = await db.aiWorkItem.findUniqueOrThrow({ where: { id: assignment.workItemId },
      select: { assigneeId: true } });
    assert.equal(runRow.metadata.aiAgentId, agent.id);
    assert.equal(work.assigneeId, agent.id);
    report.persistedAgentBinding = true;
  }
  const projected = await request(`/v1/orchestrator/runs/${runId}`, undefined, 'GET');
  report.publicRunMetadataPresent = Object.hasOwn(projected.data ?? {}, 'metadata');
  assert.equal(report.publicRunMetadataPresent, false, 'Old run response unexpectedly exposes metadata');
  const schedulerSource = readFileSync(join(oldRoot,
    'packages/happy-server/sources/app/orchestrator/scheduler.ts'), 'utf8');
  const dispatchBlock = schedulerSource.match(/payload: \{\s*executionId: execution\.id,[\s\S]*?permissionMode: task\.permissionMode[\s\S]*?\n\s*\},/)?.[0];
  assert.ok(dispatchBlock, 'Old scheduler dispatch block changed');
  report.dispatchPayloadHasAgentIdentity = /assignedAgentId|teamId|projectId|parentTaskId/.test(dispatchBlock);
  assert.equal(report.dispatchPayloadHasAgentIdentity, false);
  report.machineReady = Boolean(machine);
  const executionSelect = { id: true, status: true, childSessionId: true,
    startedAt: true, outputText: true, errorCode: true, pid: true };
  const execution = await until(() => db.orchestratorExecution.findFirst({
    where: { taskId }, orderBy: { createdAt: 'desc' },
    select: executionSelect }), 45_000);
  const ended = await until(async () => {
    const row = await db.orchestratorExecution.findUnique({ where: { id: execution.id },
      select: executionSelect });
    return row && ['completed', 'failed', 'cancelled', 'timeout'].includes(row.status) ? row : null;
  }, 180_000);
  report.executionStatus = ended.status;
  report.errorCode = ended.errorCode ?? null;
  report.providerPidRecorded = Number.isSafeInteger(ended.pid) && ended.pid > 0;
  report.providerStarted = report.providerPidRecorded;
  const queueBase = join(home, 'orchestrator-finish-queue');
  const bindingFile = `${sha(execution.id)}.json`;
  const bindings = existsSync(queueBase) ? readdirSync(queueBase).flatMap((directory) => {
    const path = join(queueBase, directory, 'legacy-telemetry', bindingFile);
    return existsSync(path) ? [JSON.parse(readFileSync(path, 'utf8'))] : [];
  }) : [];
  report.localLegacyBinding = bindings.length === 1 && bindings[0].executionId === execution.id
    && bindings[0].runId === runId && bindings[0].taskId === taskId
    && bindings[0].machineId === machineId;
  report.finalContainsMarker = String(ended.outputText ?? '').includes('PROBE_READ_ONLY_OK');
  report.repoClean = git(['status', '--porcelain']).trim() === '';
  assert.equal(report.repoClean, true, 'Read-only repository changed');
  if (generic) {
    assert.equal(report.providerPidRecorded, true, 'Generic provider PID was not recorded');
    assert.equal(report.localLegacyBinding, true, 'Generic legacy binding missing');
    assert.equal(report.executionStatus, 'completed', 'Generic task did not complete');
    assert.equal(report.finalContainsMarker, true, 'Generic final response omitted marker');
    report.result = 'GENERIC_COMPLETED';
  } else {
    assert.equal(report.providerPidRecorded, false, 'Old Agent provider started before origin rejection');
    assert.equal(report.localLegacyBinding, false, 'Old Agent was classified as generic legacy');
    assert.equal(report.executionStatus, 'failed', 'Old Agent execution was not rejected');
    assert.equal(report.errorCode, 'LEGACY_AGENT_IDENTITY_UNVERIFIED');
    report.result = 'AGENT_REJECTED';
  }
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  report.failure = message.includes('AI Agent assignment was classified as generic legacy')
    ? 'AGENT_ACCEPTED_AS_GENERIC_LEGACY'
    : message.includes('Probe deadline exceeded') ? 'PROBE_DEADLINE'
      : error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
        ? error.name : 'UnknownError';
  const serverText = children[0]?.output?.() ?? '';
  report.serverExitCode = children[0]?.proc?.exitCode ?? null;
  report.serverStages = existsSync(join(owner, 'server-stages'))
    ? readFileSync(join(owner, 'server-stages'), 'utf8').trim().split('\n') : [];
  report.healthStatus = healthStatus;
  report.serverErrorKinds = [...new Set(serverText.match(/(?:PrismaClientInitializationError|ECONNREFUSED|ENOTFOUND|P100\d|ERR_[A-Z_]+|Error:)/g) ?? [])];
  process.exitCode = 1;
} finally {
  for (const proc of children.reverse()) {
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
      await Promise.race([new Promise((done) => proc.once('exit', done)), delay(3000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
  }
  if (db) await db.$disconnect();
  if (report.oldRootIdentityBefore) {
    try {
      report.oldRootIdentityAfter = verifyOldServerTrackedTree(oldRoot, revision, root);
      report.oldRootIdentityStable = report.oldRootIdentityAfter.trackedTreeSha256
        === report.oldRootIdentityBefore.trackedTreeSha256;
      if (!report.oldRootIdentityStable) {
        report.result = 'INCOMPLETE';
        process.exitCode = 1;
      }
    } catch {
      report.oldRootIdentityStable = false;
      report.result = 'INCOMPLETE';
      process.exitCode = 1;
    }
  }
  if (accountId && machineId && redisUrl) {
    const Redis = require('ioredis');
    const client = new Redis(redisUrl);
    try {
      const source = readFileSync(join(root, 'packages/happy-cli/src/api/apiMachine.ts'), 'utf8');
      const suffixes = [...source.matchAll(/registerHandler\('([^']+)'/g)].map((match) => match[1]);
      let removed = 0;
      for (const suffix of suffixes) {
        const method = `${machineId}:${suffix}`;
        const id = sha(`${accountId}\0${method}`);
        const route = `happy:rpc:route:v1:${id}`;
        const epoch = `happy:rpc:epoch:v1:${id}`;
        const value = await client.get(route);
        if (value) {
          const parsed = JSON.parse(value);
          assert.equal(parsed.accountId, accountId);
          assert.equal(parsed.method, method);
        }
        removed += await client.del(route, epoch);
      }
      report.ownedRedisKeysRemoved = removed;
    } finally { client.disconnect(); }
  }
  if (databaseCreated) {
    await admin.$executeRawUnsafe('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', databaseName);
    await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    report.ownedDatabaseDropped = true;
  }
  if (admin) await admin.$disconnect();
  rmSync(owner, { recursive: true, force: true });
  report.ownedTempRemoved = !existsSync(owner);
  console.log(JSON.stringify(report));
}
