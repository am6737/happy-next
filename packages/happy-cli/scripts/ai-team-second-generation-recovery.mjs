import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, readdirSync,
  rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const lifecycleKind = process.env.HAPPY_TEST_LIFECYCLE_KIND;
assert.ok(!lifecycleKind || ['cancel', 'timeout', 'normal', 'approval-cancel', 'approval-timeout', 'steer'].includes(lifecycleKind));
const freshRoot = process.env.HAPPY_TEST_FRESH_ROOT;
const cliPackageRoot = process.env.HAPPY_TEST_CLI_PACKAGE_ROOT;
const cliEntry = process.env.HAPPY_TEST_CLI_ENTRY;
const cliSha = process.env.HAPPY_TEST_CLI_SHA256;
assert.ok(freshRoot && isAbsolute(freshRoot) && cliEntry && isAbsolute(cliEntry)
  && /^[0-9a-f]{64}$/.test(cliSha), 'Fresh root, entry and SHA256 are required');
const fresh = realpathSync(freshRoot);
const packageRoot = cliPackageRoot ? realpathSync(cliPackageRoot)
  : join(fresh, 'packages/happy-cli');
const entry = realpathSync(cliEntry);
assert.ok(entry.startsWith(`${packageRoot}/dist/`), 'Entry is outside isolated CLI dist');
const require = createRequire(join(fresh, 'packages/happy-server/package.json'));
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(entry)), cliSha);
const dist = join(packageRoot, 'dist');
const snapshot = () => {
  const rows = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else {
        assert.ok(stat.isFile(), 'Fresh dist contains a special file');
        rows.push({ path: path.slice(dist.length + 1), mode: stat.mode & 0o777,
          sha256: hash(readFileSync(path)) });
      }
    }
  };
  visit(dist);
  return rows;
};
const ownedProcesses = (owner) => {
  const found = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    try {
      const directory = `/proc/${pid}`;
      if (lstatSync(directory).uid !== process.getuid()) continue;
      const cwd = readlinkSync(join(directory, 'cwd'));
      if (!cwd.startsWith(`${owner}/happy-p0-cli-real-`)) continue;
      const raw = readFileSync(join(directory, 'stat'), 'utf8');
      const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
      if (fields[0] !== 'Z') found.push({ pid, startTime: fields[19] });
    } catch { /* Process exited during inspection. */ }
  }
  return found;
};
const stopOwnedProcesses = async (owner) => {
  const initial = ownedProcesses(owner);
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const item of initial) {
      const current = ownedProcesses(owner).find((row) => row.pid === item.pid
        && row.startTime === item.startTime);
      if (current) try { process.kill(item.pid, signal); } catch { /* Exited. */ }
    }
    await delay(signal === 'SIGTERM' ? 1000 : 100);
  }
  return { found: initial.length, left: ownedProcesses(owner).length };
};
const initialDist = snapshot();
const expectedDistFiles = Number(process.env.HAPPY_TEST_CLI_DIST_FILES ?? '46');
assert.ok(Number.isSafeInteger(expectedDistFiles) && expectedDistFiles > 0);
assert.equal(initialDist.length, expectedDistFiles, 'CLI dist file count changed');
const configRoot = process.env.HAPPY_TEST_CONFIG_ROOT ?? sourceRoot;
assert.ok(isAbsolute(configRoot), 'Configuration root must be absolute');
const configBase = realpathSync(configRoot);
const config = Object.assign({}, ...['.env', 'packages/happy-server/.env',
  'packages/happy-server/.env.dev'].map((name) => {
  const file = join(configBase, name);
  assert.ok(lstatSync(file).isFile(), 'Configuration file is unavailable');
  return dotenv.parse(readFileSync(file));
}));
const sourceUrl = config.DATABASE_URL ?? process.env.DATABASE_URL;
assert.ok(sourceUrl, 'Test database is unavailable');
const databaseName = `happy_cli_recovery_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
databaseUrl.searchParams.set('connection_limit', '2');
databaseUrl.searchParams.set('pool_timeout', '10');
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const owner = mkdtempSync(join(tmpdir(), 'happy-cli-second-recovery-'));
chmodSync(owner, 0o700);
const diagnosticRoot = mkdtempSync(join(tmpdir(), 'happy-cli-recovery-diagnostic-'));
chmodSync(diagnosticRoot, 0o700);
const runnerLog = join(diagnosticRoot, 'runner.log');
const apiLog = join(diagnosticRoot, 'api.log');
writeFileSync(runnerLog, '', { flag: 'wx', mode: 0o600 });
writeFileSync(apiLog, '', { flag: 'wx', mode: 0o600 });
const logBytes = { runner: 0, api: 0 };
let diagnosticsOpen = true;
let diagnosticWriteFailed = false;
const appendPrivateLog = (kind, file, chunk) => {
  if (!diagnosticsOpen) return;
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = 16 * 1024 * 1024 - logBytes[kind];
  if (remaining <= 0) return;
  try {
    appendFileSync(file, bytes.subarray(0, remaining));
    logBytes[kind] += Math.min(bytes.length, remaining);
  } catch { diagnosticWriteFailed = true; }
};
const operatorKey = join(owner, 'operator-private.pem');
const operator = generateKeyPairSync('ed25519');
writeFileSync(operatorKey, operator.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  { mode: 0o600, flag: 'wx' });
const port = async () => {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const result = socket.address().port;
  await new Promise((done) => socket.close(done));
  return result;
};
const report = { result: 'INCOMPLETE', entrySha256: cliSha, distFiles: initialDist.length };
let server, databaseCreated = false, db;
let stage = 'database_create';
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  stage = 'port_selection';
  const apiPort = await port();
  let metricsPort = await port();
  for (let attempt = 0; metricsPort === apiPort && attempt < 10; attempt++) metricsPort = await port();
  assert.notEqual(metricsPort, apiPort, 'Isolated API and metrics ports overlap');
  const env = { ...process.env, ...config, DATABASE_URL: databaseUrl.toString(),
    DATABASE_POOL_SIZE: '2', PORT: String(apiPort), METRICS_PORT: String(metricsPort),
    AI_WEBAUTHN_RP_ID: 'localhost', AI_WEBAUTHN_ORIGIN: `http://localhost:${apiPort}`,
    AI_WEBAUTHN_TRUST_PUBLIC_KEY_SPKI: operator.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  stage = 'migration';
  const migrated = spawnSync(join(fresh, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: join(fresh, 'packages/happy-server'), env, encoding: 'utf8', timeout: 180_000 });
  assert.equal(migrated.status, 0, 'Fresh isolated migration failed');
  db = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  stage = 'server_start';
  server = spawn(join(fresh, 'node_modules/.bin/tsx'),
    ['--tsconfig', 'tsconfig.json', 'sources/main.ts'], {
      cwd: join(fresh, 'packages/happy-server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => {
    appendPrivateLog('api', apiLog, chunk);
  });
  const base = `http://127.0.0.1:${apiPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) break;
    try { ready = (await fetch(`${base}/v1/orchestrator/context`,
      { signal: AbortSignal.timeout(1000) })).status === 401; } catch { /* Starting. */ }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, 'Fresh Server did not start');
  stage = 'runner_start';
  const runner = spawn(process.execPath,
    [join(sourceRoot, 'packages/happy-cli/scripts/ai-team-p0-real-e2e.mjs')], {
      cwd: join(sourceRoot, 'packages/happy-cli'),
      env: { ...env, TMPDIR: owner, HAPPY_TEST_SERVER_URL: base,
        HAPPY_TEST_CLI_ENTRY: entry,
        ...(lifecycleKind ? lifecycleKind === 'normal' ? {}
          : lifecycleKind === 'approval-cancel' ? { HAPPY_TEST_APPROVAL_PUBLIC: '1', HAPPY_TEST_APPROVAL_PROVIDER_CANCEL: '1' }
          : lifecycleKind === 'approval-timeout' ? { HAPPY_TEST_APPROVAL: '1', HAPPY_TEST_APPROVAL_PROVIDER_TIMEOUT: '1' }
          : lifecycleKind === 'steer' ? { HAPPY_TEST_P1: '1', HAPPY_TEST_STEER: '1' }
          : { [lifecycleKind === 'cancel' ? 'HAPPY_TEST_PROVIDER_CANCEL' : 'HAPPY_TEST_PROVIDER_TIMEOUT']: '1' }
          : { HAPPY_TEST_APPROVAL_PUBLIC: '1', HAPPY_TEST_CAPABILITY_RECOVERY: '1',
              HAPPY_TEST_CAPABILITY_RECOVERY_TWICE: '1', HAPPY_TEST_HUMAN_OPERATOR_KEY_FILE: operatorKey }) },
      stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [runner.stdout, runner.stderr]) stream.on('data', (chunk) => {
    appendPrivateLog('runner', runnerLog, chunk);
    output = `${output}${chunk}`.slice(-20_000);
  });
  const timeout = new AbortController();
  const runnerExit = await Promise.race([
    new Promise((done) => runner.once('exit', (code) => done(code))),
    delay(lifecycleKind === 'steer' ? 420_000 : 180_000, undefined, { signal: timeout.signal }).then(() => {
      runner.kill('SIGKILL'); return -1;
    }, () => undefined),
  ]);
  timeout.abort();
  stage = 'runner_validation';
  report.runnerExit = runnerExit;
  report.firstAndSecondConfirmation = !lifecycleKind && output.includes('REAL_SECOND_DRAIN_OWNER_RECONFIRMED');
  report.terminalFailed = !lifecycleKind && output.includes('ACTUAL_CAPABILITY_RECOVERY_REQUIRES_OWNER_CONFIRMATION');
  report.sdkProcessExited = !lifecycleKind && output.includes('"sdkProcessExited":true');
  report.providerLifecycleVerified = !!lifecycleKind && output.includes('ACTUAL_PROVIDER_TERMINATION_PASS')
    && output.includes('"providerProcessExited":true') && output.includes('"lateFinishAndRetryAbsent":true');
  if (lifecycleKind === 'approval-cancel') report.providerLifecycleVerified =
    output.includes('ACTUAL_APPROVAL_SDK_CANCEL_PASS') && output.includes('"providerProcessExited":true');
  if (lifecycleKind === 'approval-timeout') report.providerLifecycleVerified =
    output.includes('ACTUAL_APPROVAL_SDK_TIMEOUT_PASS') && output.includes('"providerProcessExited":true');
  report.normalRunVerified = lifecycleKind === 'normal' && output.includes('"result":"PASS"');
  report.runnerFailureKind = [
    'browserType.launch',
    'Actual provider process was not observed while original execution ran',
    'Observed provider process remained after execution termination',
    'Provider cancel did not catch a running execution',
    'Provider cancelled was not enforced on the original execution',
    'Late finish or retry changed the terminated execution',
    'P0_REAL_E2E_FAILED',
  ].find((kind) => output.includes(kind)) ?? (runnerExit === 0 ? null : 'RUNNER_EXIT_UNCLASSIFIED');
  const failureLine = output.match(/P0_REAL_E2E_FAILED: ([^\r\n]{1,500})/)?.[1];
  report.runnerFailureDetail = failureLine ? (
    failureLine.startsWith('Provider timeout boundary failed:') ? 'PROVIDER_TIMEOUT_BOUNDARY_FAILED'
      : failureLine.startsWith('Provider cancelled boundary failed:') ? 'PROVIDER_CANCEL_BOUNDARY_FAILED'
        : 'RUNNER_ERROR_IN_PRIVATE_LOG') : null;
  const observationLine = output.match(/Actual provider process was not observed while original execution ran: (\{[^\r\n]+\})/)?.[1];
  if (observationLine) report.providerObservation = JSON.parse(observationLine);
  report.lifecycleStages = ['PROVIDER_PROCESS_OBSERVED', 'PROVIDER_CANCEL_REQUEST_ACKED',
    'PROVIDER_TERMINAL_POLL_STARTED', 'PROVIDER_TERMINAL_OBSERVED', 'PROVIDER_TERMINAL_BOUNDARY_CHECKS',
    'PROVIDER_PROCESS_EXITED', 'ACTUAL_PROVIDER_TERMINATION_PASS']
    .filter((stage) => output.includes(`"result":"${stage}"`));
  const boundaryLine = output.match(/\{"result":"PROVIDER_TERMINAL_BOUNDARY_CHECKS"[^\r\n]*\}/)?.[0];
  if (boundaryLine) {
    const boundary = JSON.parse(boundaryLine);
    report.failedBoundaryChecks = boundary.failedChecks;
    report.providerExitedAtBoundary = boundary.providerExited;
  }
  if (lifecycleKind === 'steer') {
    const passLine = output.match(/\{"result":"P1_TWO_MEMBER_REAL_PASS"[^\r\n]*\}/)?.[0];
    const teamRunId = passLine ? JSON.parse(passLine).runId : null;
    assert.ok(typeof teamRunId === 'string' && teamRunId.length > 0, 'Original P1 team run identity missing');
    const tasks = await db.orchestratorTask.findMany({ where: { runId: teamRunId },
      select: { id: true, status: true, collaborationRole: true } });
    const executions = await db.orchestratorExecution.findMany({ where: { runId: teamRunId },
      select: { id: true, taskId: true, status: true } });
    report.executionCount = executions.length;
    report.teamTaskCount = tasks.length;
    const otherRuns = await db.orchestratorRun.findMany({ where: { id: { not: teamRunId } },
      select: { id: true, metadata: true } });
    report.coordinatorChatRunCount = otherRuns.filter((run) => run.metadata?.coordinatorChat === true).length;
    report.otherExecutionCount = await db.orchestratorExecution.count({ where: { runId: { not: teamRunId } } });
    assert.ok(runnerExit === 0 && tasks.length === 4 && executions.length === 4
      && tasks.filter((task) => task.collaborationRole === 'delegated').length === 2
      && tasks.some((task) => task.collaborationRole === 'leader_plan')
      && tasks.some((task) => task.collaborationRole === 'aggregate')
      && tasks.every((task) => task.status === 'completed')
      && executions.every((item) => item.status === 'completed'),
    'Real steering did not finish its original run and members');
    for (const execution of executions) {
      assert.equal(await db.orchestratorExecution.count({ where: { taskId: execution.taskId } }), 1);
    }
    report.result = 'REAL_STEERING_RESUME_LIFECYCLE_VERIFIED';
  } else {
  const executions = await db.orchestratorExecution.findMany({ select: {
    id: true, status: true, errorCode: true, worktreePath: true, taskId: true } });
  assert.equal(executions.length, 1, 'Recovery created another execution');
  const execution = executions[0];
  report.executionStatus = execution.status;
  report.executionErrorCode = execution.errorCode;
  assert.equal(await db.orchestratorExecution.count({ where: { taskId: execution.taskId } }), 1);
  report.terminalEvents = await db.aiPersistentExecutionEvent.count({ where: {
    executionId: execution.id, kind: 'status', phase: 'finished' } });
  assert.equal(report.terminalEvents, 1, 'Execution emitted duplicate or missing terminal event');
  if (lifecycleKind === 'cancel' || lifecycleKind === 'approval-cancel') assert.equal(execution.status, 'cancelled');
  else if (lifecycleKind === 'timeout' || lifecycleKind === 'approval-timeout') {
    assert.ok(['failed', 'timeout'].includes(execution.status));
    assert.ok(['TASK_TIMEOUT', 'WATCHDOG_TIMEOUT'].includes(execution.errorCode));
  } else if (lifecycleKind === 'normal') {
    assert.equal(execution.status, 'completed');
    assert.equal(execution.errorCode, null);
  } else {
    assert.equal(execution.status, 'failed');
    assert.equal(execution.errorCode, 'EXECUTION_CAPABILITY_EXPIRED');
  }
  assert.ok(execution.worktreePath && (lifecycleKind === 'normal'
    ? existsSync(join(execution.worktreePath, 'exact.txt'))
    : !existsSync(join(execution.worktreePath, 'exact.txt'))),
  'Worktree file state does not match the execution result');
  assert.ok(runnerExit === 0 && (lifecycleKind === 'normal' ? report.normalRunVerified
    : lifecycleKind ? report.providerLifecycleVerified
    : report.firstAndSecondConfirmation && report.terminalFailed && report.sdkProcessExited),
  lifecycleKind ? 'Provider lifecycle did not complete' : 'Second-generation daemon recovery did not complete');
  report.result = lifecycleKind ? `PROVIDER_${lifecycleKind.toUpperCase()}_LIFECYCLE_VERIFIED`
    : 'SECOND_GENERATION_DAEMON_DRAIN_VERIFIED';
  }
} catch (error) {
  report.failure = error instanceof Error ? error.name : 'UnknownError';
  report.failureStage = stage;
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((done) => server.once('exit', done)), delay(3000)]);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
      await Promise.race([new Promise((done) => server.once('exit', done)), delay(3000)]);
    }
  }
  if (db) await db.$disconnect();
  if (databaseCreated) {
    await admin.$executeRawUnsafe('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', databaseName);
    await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    report.databaseDropped = true;
  }
  await admin.$disconnect();
  const residual = await stopOwnedProcesses(owner);
  report.ownedProcessesCleaned = residual.found;
  report.ownedProcessesRemaining = residual.left;
  if (residual.found || residual.left) process.exitCode = 1;
  rmSync(owner, { recursive: true });
  report.ownedTempRemoved = true;
  report.distUnchanged = JSON.stringify(snapshot()) === JSON.stringify(initialDist);
  if (!report.distUnchanged) process.exitCode = 1;
  diagnosticsOpen = false;
  report.diagnosticWriteFailed = diagnosticWriteFailed;
  if (diagnosticWriteFailed) process.exitCode = 1;
  if (process.exitCode || report.result === 'INCOMPLETE') {
    report.diagnosticLogDirectory = diagnosticRoot;
    report.diagnosticLogs = { runner: runnerLog, api: apiLog };
    report.diagnosticLogTruncated = Object.fromEntries(Object.entries(logBytes)
      .map(([kind, bytes]) => [kind, bytes >= 16 * 1024 * 1024]));
  } else {
    rmSync(diagnosticRoot, { recursive: true });
  }
  console.log(JSON.stringify(report));
}
