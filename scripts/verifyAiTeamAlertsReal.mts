import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { productionModule, resolveProductionRuntime } from './aiTeamProductionRuntime.mjs';

const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || !['--report-file', '--target-outage-report'].includes(args[0]) || !args[1])) {
    throw new Error('Usage: verifyAiTeamAlertsReal.mts [--report-file NEW_PATH | --target-outage-report NEW_PATH]');
}
const reportPath = args[1];
const outageMode = args[0] === '--target-outage-report';
const reportFormat = outageMode ? 'happy-ai-team-metrics-outage-real-v1' : 'happy-ai-team-alert-real-v1';
const artifactContextFile = process.env.AI_TEAM_ARTIFACT_CONTEXT_FILE ?? null;
if (artifactContextFile) {
    assert.match(resolve(artifactContextFile), /^\/tmp\/ai-team-artifact-context-[A-Za-z0-9-]+\.json$/);
    const stat = lstatSync(artifactContextFile);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Artifact context must be a regular file');
}
const artifactContextSha256 = artifactContextFile
    ? createHash('sha256').update(readFileSync(artifactContextFile)).digest('hex') : null;
const runtime = resolveProductionRuntime(sourceRoot, artifactContextFile);
const runtimeRoot = runtime.runtimeRoot;
const importRuntime = (path: string) => import(productionModule(runtimeRoot, path));
if (reportPath) await writeFile(reportPath, `${JSON.stringify({ format: reportFormat,
    result: 'unknown', reason: 'verification_in_progress', artifactContextSha256 })}\n`, { flag: 'wx', mode: 0o600 });
const candidateDigest = () => {
    if (artifactContextFile && createHash('sha256').update(readFileSync(artifactContextFile)).digest('hex')
        !== artifactContextSha256) throw new Error('Artifact context changed during alert run');
    const result = spawnSync(process.execPath, [new URL('./aiTeamProductionPreflight.mjs', import.meta.url).pathname,
        ...(artifactContextFile ? ['--artifact-context', artifactContextFile] : [])],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 2000000 });
    assert.equal(result.status, 0, 'Candidate inventory failed');
    const audit = JSON.parse(result.stdout);
    assert.equal(audit.artifactContextSha256, artifactContextSha256);
    if (artifactContextFile) assert.equal(audit.artifactRuntimeRoot, runtimeRoot);
    const digest = audit.candidateSha256;
    assert.match(digest, /^[a-f0-9]{64}$/);
    return digest as string;
};

// Real PostgreSQL counters, production /metrics and Prometheus with unchanged
// production alert durations. Budget/Decision rows are owned fixtures, not
// provider billing; no human notification or production deployment occurs.
const require = createRequire(join(runtimeRoot, 'packages/happy-server/package.json'));
const { PrismaClient } = require('@prisma/client');
const sourceUrl = new URL(process.env.DATABASE_URL!);
const tag = randomBytes(8).toString('hex');
const databaseName = `happy_ai_alert_${tag}`;
const fixtureUrl = new URL(sourceUrl); fixtureUrl.pathname = `/${databaseName}`;
const admin = new PrismaClient();
const directory = await mkdtemp(join(tmpdir(), 'happy-ai-alert-real-'));
const containerName = `happy-ai-alert-${tag}`;
const digest = 'prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996';
let created = false; let fixture: any; let productionDb: any; let redis: any;
let metricsApp: any; let prometheus: ChildProcess | undefined; let exitCode = 0;
const candidateBefore = candidateDigest();
const rulesSha256 = createHash('sha256').update(await readFile(join(runtimeRoot,
    'monitoring/ai-team-alerts.yml'))).digest('hex');
const startedAt = new Date().toISOString();
let firingElapsedMs: number | null = null; let recoveryElapsedMs: number | null = null;
let observedFiring: string[] = []; let fixtureCleaned = false;
let targetScrapeVerified = false; let actualTargetStopped = false; let actualTargetRestarted = false;
let targetDownVerified = false; let targetRecoveryScrapeVerified = false;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`); created = true;
    const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
        cwd: join(runtimeRoot, 'packages/happy-server'),
        env: { ...process.env, DATABASE_URL: fixtureUrl.toString() },
        encoding: 'utf8', timeout: 180000, maxBuffer: 2000000,
    });
    assert.equal(migrated.status, 0, 'Isolated migration failed');
    process.env.DATABASE_URL = fixtureUrl.toString();
    fixture = new PrismaClient({ datasources: { db: { url: fixtureUrl.toString() } } });
    const account = await fixture.account.create({ data: { publicKey: `alert-fixture-${tag}` } });
    const workspace = await fixture.aiWorkspace.create({ data: { ownerAccountId: account.id,
        name: tag, members: { create: { memberAccountId: account.id, role: 'owner' } } } });
    const agent = await fixture.aiAgent.create({ data: { accountId: account.id, name: tag,
        role: 'fixture', description: '', emoji: '', instructions: '', settings: {} } });
    const conversation = await fixture.aiConversation.create({ data: { accountId: account.id,
        scopeKey: tag, kind: 'direct', agentId: agent.id, title: tag } });
    const run = await fixture.orchestratorRun.create({ data: { accountId: account.id, title: tag,
        status: 'running', tasks: { create: { seq: 1, taskKey: 'alert', provider: 'codex',
            prompt: '', status: 'running' } } }, include: { tasks: true } });
    const execution = await fixture.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId: tag, provider: 'codex', status: 'running', dispatchToken: hash(tag) } });
    const work = await fixture.aiWorkItem.create({ data: { accountId: account.id, title: tag,
        summary: 'Owned alert fixture', sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id,
        assigneeId: agent.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
    const decision = await fixture.aiDecisionRequest.create({ data: { accountId: account.id,
        workspaceId: workspace.id, workItemId: work.id, runId: run.id, taskId: run.tasks[0].id,
        executionId: execution.id, machineId: tag, dispatchTokenHash: hash(execution.dispatchToken),
        kind: 'approval', operationId: tag, payload: {}, status: 'decided', deliveryStatus: 'blocked',
        decision: 'approved', decidedBy: account.id, version: 2, expiresAt: new Date(Date.now() + 3600000) } });
    const policy = await fixture.aiBudgetPolicy.create({ data: { workspaceId: workspace.id,
        scopeKey: tag, periodStart: new Date(Date.now() - 60000), periodEnd: new Date(Date.now() + 900000),
        limitMicros: 100n, perRunReserveMicros: 15n, usedMicros: 80n, reservedMicros: 15n } });
    const metrics = await importRuntime('packages/happy-server/sources/app/monitoring/metrics2');
    productionDb = (await importRuntime('packages/happy-server/sources/storage/db')).db;
    redis = (await importRuntime('packages/happy-server/sources/storage/redis')).redis;
    await metrics.updateDatabaseMetrics();
    metricsApp = await (await importRuntime('packages/happy-server/sources/app/monitoring/metrics')).createMetricsServer();
    const base = await metricsApp.listen({ host: '127.0.0.1', port: 0 });
    const exported = await fetch(`${base}/metrics`);
    assert.equal(exported.status, 200);
    const metricText = await exported.text();
    assert.match(metricText, /^ai_budget_max_utilization_ratio 0\.95$/m);
    assert.match(metricText, /ai_workflow_queue_items\{queue="decision_delivery",status="blocked"\} 1/);
    assert.ok(![account.id, workspace.id, run.id, execution.id].some(id => metricText.includes(id)));
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    await copyFile(join(runtimeRoot, 'monitoring/ai-team-alerts.yml'), join(directory, 'ai-team-alerts.yml'));
    await writeFile(join(directory, 'prometheus.yml'), `global:\n  scrape_interval: 5s\n  evaluation_interval: 5s\nrule_files:\n  - /fixture/ai-team-alerts.yml\nscrape_configs:\n  - job_name: happy-server\n    static_configs:\n      - targets: ['${new URL(base).host}']\n`);
    prometheus = spawn('docker', ['run', '--rm', '--name', containerName, '--label', `happy.ai-team.fixture=${tag}`,
        '--network', 'host', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
        '--user', `${process.getuid!()}:${process.getgid!()}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', `${directory}:/fixture:ro`, '--entrypoint', '/bin/prometheus', digest,
        '--config.file=/fixture/prometheus.yml', '--storage.tsdb.path=/tmp/tsdb',
        `--web.listen-address=127.0.0.1:${port}`, '--log.level=error'], { stdio: 'ignore' });
    const expected = outageMode ? ['AiServerMetricsUnavailable'] : ['AiBudgetHighWater', 'AiDecisionDeliveryBlocked'];
    const alerts = async () => {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/alerts`, { signal: AbortSignal.timeout(3000) });
        assert.equal(response.status, 200);
        return (await response.json() as any).data.alerts as Array<{ state: string; labels: Record<string, string> }>;
    };
    const targetUpIs = async (value: '0' | '1') => {
        const query = new URLSearchParams({ query: 'up{job="happy-server"}' });
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/query?${query}`, { signal: AbortSignal.timeout(3000) });
        assert.equal(response.status, 200);
        const result = (await response.json() as any).data.result;
        return result.length === 1 && result[0].metric.instance === new URL(base).host && result[0].value[1] === value;
    };
    if (outageMode) {
        const scrapeStarted = Date.now();
        while (Date.now() - scrapeStarted < 30000) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/v1/targets`, { signal: AbortSignal.timeout(3000) });
                const targets = (await response.json() as any).data.activeTargets;
                if (targets.some((target: any) => target.labels.job === 'happy-server'
                    && target.health === 'up' && target.scrapeUrl === `${base}/metrics`)) {
                    targetScrapeVerified = true; break;
                }
            } catch { /* The owned collector may still be starting. */ }
            await pause(1000);
        }
        assert.ok(targetScrapeVerified, 'Owned production metrics target was never successfully scraped');
        await metricsApp.close();
        await assert.rejects(fetch(`${base}/metrics`, { signal: AbortSignal.timeout(3000) }));
        actualTargetStopped = true;
        console.log('ACTUAL_PRODUCTION_METRICS_TARGET_STOPPED_AFTER_SUCCESSFUL_SCRAPE');
    }
    const started = Date.now(); let firing: string[] = []; let lastReport = 0;
    while (Date.now() - started < 450000) {
        if (prometheus.exitCode !== null || prometheus.signalCode !== null) throw new Error('Owned Prometheus exited');
        const current = await alerts().catch(() => []);
        firing = current.filter(alert => alert.state === 'firing').map(alert => alert.labels.alertname);
        if (expected.every(name => firing.includes(name))) break;
        if (Date.now() - lastReport > 60000) {
            console.log(JSON.stringify({ phase: 'waiting_for_unchanged_5m_rules', elapsedMs: Date.now() - started,
                pending: current.filter(alert => alert.state === 'pending').map(alert => alert.labels.alertname) }));
            lastReport = Date.now();
        }
        await pause(5000);
    }
    assert.ok(expected.every(name => firing.includes(name)), 'Actual alerts did not fire within the unchanged rule duration');
    firingElapsedMs = Date.now() - started; observedFiring = firing;
    if (outageMode) {
        targetDownVerified = await targetUpIs('0');
        assert.ok(targetDownVerified, 'Outage alert did not correspond to the actual failed scrape target');
        assert.ok(!firing.includes('AiWorkflowMetricsMissing') && !firing.includes('AiBudgetWatermarkMetricsMissing'),
            'Failed scrape was misclassified as an application metric field missing');
    }
    console.log(JSON.stringify({ phase: 'actual_prometheus_firing', alerts: firing, elapsedMs: Date.now() - started }));
    if (outageMode) {
        metricsApp = await (await importRuntime('packages/happy-server/sources/app/monitoring/metrics')).createMetricsServer();
        const restartedBase = await metricsApp.listen({ host: '127.0.0.1', port: Number(new URL(base).port) });
        assert.equal(restartedBase, base);
        assert.equal((await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(3000) })).status, 200);
        actualTargetRestarted = true;
    } else {
        await fixture.aiBudgetPolicy.update({ where: { id: policy.id }, data: { usedMicros: 30n } });
        await fixture.aiDecisionRequest.update({ where: { id: decision.id }, data: { deliveryStatus: 'delivered' } });
        await metrics.updateDatabaseMetrics();
    }
    const recoveryStarted = Date.now(); let recovered = false;
    while (Date.now() - recoveryStarted < 90000) {
        const current = await alerts();
        if (current.every(alert => !expected.includes(alert.labels.alertname))
            && (!outageMode || await targetUpIs('1'))) {
            if (outageMode) targetRecoveryScrapeVerified = true;
            recovered = true; break;
        }
        await pause(5000);
    }
    assert.ok(recovered, 'Actual alerts did not recover after the owned DB state recovered');
    recoveryElapsedMs = Date.now() - recoveryStarted;
    console.log(outageMode ? 'REAL_PRODUCTION_METRICS_TARGET_OUTAGE_ORIGINAL_5M_FIRE_AND_RESTART_RECOVERY_OK'
        : 'REAL_DB_PRODUCTION_METRICS_PROMETHEUS_ORIGINAL_5M_ALERT_FIRE_AND_RECOVERY_OK');
} catch (error) {
    exitCode = 1;
    console.error(JSON.stringify({ result: 'AI_ALERT_REAL_FAILED', name: (error as Error).name,
        code: (error as { code?: string }).code ?? null }));
} finally {
    if (prometheus) {
        spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore', timeout: 15000 });
        if (prometheus.exitCode === null) prometheus.kill('SIGTERM');
    }
    await metricsApp?.close(); await productionDb?.$disconnect(); redis?.disconnect();
    await fixture?.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    assert.equal((await admin.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname=$1', databaseName)).length, 0);
    await admin.$disconnect(); await rm(directory, { recursive: true, force: true });
    fixtureCleaned = true;
    console.log('AI_ALERT_REAL_FIXTURE_CLEANUP databases=1 residual=0');
}
const candidateAfter = candidateDigest();
const candidateStable = candidateBefore === candidateAfter;
if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify({ format: reportFormat,
        startedAt, completedAt: new Date().toISOString(),
        candidateSha256: candidateBefore, candidateAfterSha256: candidateAfter, candidateStable,
        artifactContextSha256, sourceRoot, runtimeRoot,
        rulesSha256, prometheusImage: digest, firingAlerts: observedFiring,
        firingElapsedMs, recoveryElapsedMs, fixtureCleaned,
        chainVerified: exitCode === 0 && fixtureCleaned,
        ...(outageMode ? { targetScrapeVerified, actualTargetStopped, targetDownVerified,
            actualTargetRestarted, targetRecoveryScrapeVerified } : {}),
        result: exitCode !== 0 ? 'failed' : fixtureCleaned && candidateStable ? 'passed' : 'unknown',
        humanNotificationVerified: false,
    }, null, 2)}\n`, { flag: 'w', mode: 0o600 });
    if (!candidateStable) exitCode = 1;
}
process.exit(exitCode);
