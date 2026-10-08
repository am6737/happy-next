import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AiRuntimeResultProjectionSchema } from 'happy-wire';

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
const dotenv = require('dotenv');
const entry = process.env.HAPPY_TEST_CLI_ENTRY;
const expectedSha = process.env.HAPPY_TEST_CLI_SHA256;
assert.ok(entry && /^[0-9a-f]{64}$/.test(expectedSha ?? ''), 'Isolated CLI entry and SHA required');
assert.equal(createHash('sha256').update(readFileSync(entry)).digest('hex'), expectedSha);
const owner = mkdtempSync(join(tmpdir(), 'happy-current-runtime-probe-'));
const databaseName = `happy_runtime_${randomBytes(8).toString('hex')}`;
const config = Object.assign({}, ...['.env', 'packages/happy-server/.env',
  'packages/happy-server/.env.dev'].map((name) => dotenv.parse(readTestConfig(name))));
const sourceUrl = config.DATABASE_URL ?? process.env.DATABASE_URL;
assert.ok(sourceUrl, 'Test database unavailable');
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const report = { entrySha256: expectedSha, result: 'INCOMPLETE' };
let db, server, created = false;
const freePort = async () => {
  const socket = createNetServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
};
const command = (name, args, options = {}) => {
  const result = spawnSync(name, args, { cwd: root, encoding: 'utf8', timeout: 180_000,
    maxBuffer: 2_000_000, ...options });
  if (result.status !== 0) throw new Error(`${name} exited ${result.status ?? result.signal}`);
  return result.stdout;
};
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const env = { ...process.env, ...config, DATABASE_URL: databaseUrl.toString(),
    DATABASE_POOL_SIZE: '2', PORT: String(await freePort()), METRICS_PORT: String(await freePort()) };
  command(join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    { cwd: join(root, 'packages/happy-server'), env });
  db = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  const base = `http://127.0.0.1:${env.PORT}`;
  server = spawn(join(root, 'node_modules/.bin/tsx'), ['--tsconfig', 'tsconfig.json', 'sources/main.ts'],
    { cwd: join(root, 'packages/happy-server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverOutput = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
  });
  let ready = false;
  for (let attempt = 0; attempt < 150 && !ready; attempt++) {
    if (server.exitCode !== null) throw new Error('Current Server exited during startup');
    try {
      const response = await fetch(`${base}/v1/orchestrator/context`, { signal: AbortSignal.timeout(1000) });
      ready = response.status === 401;
    } catch { /* Startup in progress. */ }
    if (!ready) await delay(200);
  }
  assert.equal(ready, true, 'Current Server did not start');
  const run = spawnSync(process.execPath,
    [join(root, 'packages/happy-cli/scripts/ai-team-p0-real-e2e.mjs')], {
      cwd: join(root, 'packages/happy-cli'), timeout: 240_000, maxBuffer: 2_000_000,
      encoding: 'utf8', env: { ...env, HAPPY_TEST_PROJECT: '1', HAPPY_TEST_CLI_ENTRY: entry,
        HAPPY_TEST_SERVER_URL: base, TMPDIR: owner },
    });
  report.realProviderExit = run.status;
  const line = run.stdout?.split('\n').find((row) => row.includes('"result":"PASS"'));
  report.runnerMarkers = [...new Set((run.stdout ?? '').split('\n').flatMap((row) => {
    try {
      const result = JSON.parse(row).result;
      return typeof result === 'string' && /^[A-Z0-9_]{2,70}$/.test(result) ? [result] : [];
    } catch { return []; }
  }))];
  const diagnostic = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  report.runnerFailureKinds = ['ERR_MODULE_NOT_FOUND', 'ENOENT', 'ECONNREFUSED', 'Project',
    'capability', 'No connected runtime', 'daemon', 'timeout', 'finalResponse',
    'WORKSPACE_PREPARATION_FAILED', 'UPGRADE_REQUIRED', 'MODEL', 'Codex',
    'P0_REAL_E2E_FAILED', 'auth', 'machine', 'provider', 'Server', 'HTTP',
    'workspace', 'response', 'missing', 'Unsupported', 'not found', 'EACCES',
    'configuration', 'Cannot', 'did not', 'register', 'start', 'ready', 'Prisma',
    'token', 'undefined', 'dispatch', 'finish', 'commit', 'Git'].filter((kind) => diagnostic.includes(kind));
  report.runnerKnownFailure = [
    'Completed execution has no structured final response',
    'Queued final response differs from accepted task output',
    'Internal runtime text leaked into final response',
    'Final response did not match the expected content',
    'Actual runner did not ACK ordered tool and finish events',
    'Isolated daemon did not start',
  ].find((kind) => diagnostic.includes(kind)) ?? null;
  if (run.status !== 0 && report.runnerKnownFailure !== 'Completed execution has no structured final response')
    throw new Error('Public Project provider run failed before structured projection');
  if (run.status === 0 && !line) throw new Error('Public Project provider success marker missing');
  const runs = await db.orchestratorRun.findMany({ select: { id: true, accountId: true,
    metadata: true, status: true } });
  report.checkpoint = 'run-count';
  assert.equal(runs.length, 1, 'Expected one isolated Project run');
  const row = runs[0];
  const contract = row.metadata?.aiRuntimeContract;
  assert.deepEqual(contract, { kind: 'work_item', structuredFinalResponseVersion: 1,
    deliveryProofVersion: 1 });
  report.checkpoint = 'contract';
  const tasks = await db.orchestratorTask.findMany({ where: { runId: row.id }, select: {
    status: true, prompt: true, finalResponse: true,
    executions: { select: { status: true, finalResponse: true,
      worktreePath: true, branchName: true, commitSha: true } },
  } });
  assert.equal(tasks.length, 1);
  report.checkpoint = 'task-count';
  const task = tasks[0];
  let work;
  work = await db.aiWorkItem.findFirstOrThrow({ where: { orchestratorRunId: row.id },
    select: { deliveryVerificationStatus: true, deliveryVerifiedAt: true } });
  assert.equal(row.status, 'completed');
  assert.equal(task.status, 'completed');
  assert.ok(task.finalResponse?.trim());
  report.checkpoint = 'final-response';
  const execution = task.executions.at(-1);
  assert.equal(execution?.status, 'completed');
  assert.equal(execution.finalResponse, task.finalResponse);
  report.checkpoint = 'execution-final';
  report.deliveryState = work.deliveryVerificationStatus;
  report.deliveryAtPresent = Boolean(work.deliveryVerifiedAt);
  assert.equal(work.deliveryVerificationStatus, 'pending');
  assert.equal(work.deliveryVerifiedAt, null);
  report.checkpoint = 'delivery';
  AiRuntimeResultProjectionSchema.parse({ finalResponse: task.finalResponse,
    answerVerified: true, deliveryVerified: false });
  assert.ok(execution.worktreePath && realpathSync(execution.worktreePath).startsWith(`${owner}/`));
  report.checkpoint = 'worktree';
  assert.ok(execution.branchName && /^[0-9a-f]{40}$/.test(execution.commitSha ?? ''));
  const expectedMarker = task.prompt.match(/P0_REAL_DAEMON_\d{13}/)?.[0];
  assert.ok(expectedMarker);
  report.checkpoint = 'prompt-byte-marker';
  const expectedBytes = Buffer.from(`${expectedMarker}\n`);
  const worktreeBytes = readFileSync(join(execution.worktreePath, 'exact.txt'));
  const git = (args) => execFileSync('git', args, { cwd: execution.worktreePath,
    timeout: 10_000, maxBuffer: 1_000_000 });
  assert.deepEqual(worktreeBytes, expectedBytes);
  assert.deepEqual(git(['show', 'HEAD:exact.txt']), expectedBytes);
  report.checkpoint = 'git-bytes';
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), execution.commitSha);
  assert.equal(git(['branch', '--show-current']).toString().trim(), execution.branchName);
  assert.equal(git(['status', '--porcelain']).length, 0);
  report.result = 'PROJECT_STRUCTURED_FINAL_VERIFIED';
  report.answerBytes = Buffer.byteLength(task.finalResponse);
  report.exactFileBytes = expectedBytes.length;
  report.providerAttempts = task.executions.length;
  report.frozenContract = true;
  report.deliveryVerified = false;
} catch (error) {
  report.failure = error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name : 'UnknownError';
  if (db) {
    try {
      report.executionStates = await db.orchestratorExecution.findMany({
        select: { status: true, errorCode: true }, take: 10 });
      report.runStates = await db.orchestratorRun.findMany({
        select: { status: true, metadata: true }, take: 10 }).then((rows) => rows.map((row) => ({
          status: row.status,
          contract: row.metadata?.aiRuntimeContract ?? null,
        })));
    } catch { report.databaseDiagnostics = 'unavailable'; }
  }
  report.serverErrorKinds = [...new Set((typeof serverOutput === 'string' ? serverOutput : '').match(
    /PrismaClientInitializationError|ECONNREFUSED|ENOTFOUND|P100\d|ERR_[A-Z_]+/g) ?? [])];
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((done) => server.once('exit', done)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (db) await db.$disconnect();
  if (created) {
    await admin.$executeRawUnsafe('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', databaseName);
    await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    report.databaseDropped = true;
  }
  await admin.$disconnect();
  rmSync(owner, { recursive: true, force: true });
  report.ownedTempRemoved = true;
  console.log(JSON.stringify(report));
}
