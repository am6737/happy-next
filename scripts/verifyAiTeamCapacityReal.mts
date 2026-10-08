import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
import { productionModule, resolveProductionRuntime } from './aiTeamProductionRuntime.mjs';

const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argumentsList = process.argv.includes('--http-child') ? [] : process.argv.slice(2);
const workerRpcRequested = argumentsList.includes('--worker-rpc');
const optionArguments = argumentsList.filter((arg) => arg !== '--worker-rpc');
const reportOption = optionArguments[0] === '--alert-report' ? optionArguments[1]
    : optionArguments[0] === '--verify-alert-report' ? optionArguments[1] : undefined;
if (optionArguments.length !== (reportOption ? 2 : 0)
    || (optionArguments.length && !['--alert-report', '--verify-alert-report'].includes(optionArguments[0]))
    || (workerRpcRequested && argumentsList[0] === '--verify-alert-report'))
    throw new Error('Usage: verifyAiTeamCapacityReal.mts [--alert-report PATH] [--worker-rpc] | --verify-alert-report PATH');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const artifactContextFile = process.env.AI_TEAM_ARTIFACT_CONTEXT_FILE ?? null;
if (artifactContextFile) {
    assert.match(resolve(artifactContextFile), /^\/tmp\/ai-team-artifact-context-[A-Za-z0-9-]+\.json$/);
    const stat = lstatSync(artifactContextFile);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Artifact context must be a regular file');
}
const artifactContextSha256 = artifactContextFile
    ? sha256(readFileSync(artifactContextFile)) : null;
const runtime = resolveProductionRuntime(sourceRoot, artifactContextFile);
const runtimeRoot = runtime.runtimeRoot;
const importRuntime = (path: string) => import(productionModule(runtimeRoot, path));
const require = createRequire(join(runtimeRoot, 'packages/happy-server/package.json'));
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
const candidateDigest = () => {
    if (artifactContextFile && sha256(readFileSync(artifactContextFile)) !== artifactContextSha256)
        throw new Error('Artifact context changed during capacity run');
    const inventory = spawnSync(process.execPath,
        [fileURLToPath(new URL('./aiTeamProductionPreflight.mjs', import.meta.url)),
            ...(artifactContextFile ? ['--artifact-context', artifactContextFile] : [])],
        { encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000 });
    assert.equal(inventory.status, 0, 'Candidate inventory failed');
    const audit = JSON.parse(inventory.stdout);
    assert.equal(audit.artifactContextSha256, artifactContextSha256);
    if (artifactContextFile) assert.equal(audit.artifactRuntimeRoot, runtimeRoot);
    return audit.candidateSha256 as string;
};
const verifyAlertReport = (path?: string) => {
    if (!path) return { verified: false, reason: 'report_missing', reportSha256: null };
    try {
        const bytes = readFileSync(path);
        const report = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
        let candidate: string;
        try { candidate = candidateDigest(); }
        catch { return { verified: false, reason: 'candidate_inventory_failed',
            reportSha256: sha256(bytes) }; }
        const rules = sha256(readFileSync(join(runtimeRoot, 'monitoring/ai-team-alerts.yml')));
        const names = report.firingAlerts;
        const verified = report.format === 'happy-ai-team-alert-real-v1'
            && report.result === 'passed' && report.chainVerified === true
            && report.fixtureCleaned === true && report.candidateStable === true
            && report.candidateSha256 === candidate && report.candidateAfterSha256 === candidate
            && (!artifactContextFile || report.artifactContextSha256 === artifactContextSha256)
            && report.rulesSha256 === rules
            && report.prometheusImage === 'prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996'
            && Array.isArray(names) && ['AiBudgetHighWater', 'AiDecisionDeliveryBlocked']
                .every((name) => names.includes(name))
            && typeof report.firingElapsedMs === 'number' && report.firingElapsedMs >= 300_000
            && typeof report.recoveryElapsedMs === 'number' && report.recoveryElapsedMs >= 0
            && typeof report.startedAt === 'string' && !Number.isNaN(Date.parse(report.startedAt))
            && typeof report.completedAt === 'string' && !Number.isNaN(Date.parse(report.completedAt))
            && Date.parse(report.completedAt) >= Date.parse(report.startedAt)
            && report.humanNotificationVerified === false;
        return { verified, reason: verified ? 'report_contract_matched' : 'report_or_candidate_mismatch',
            reportSha256: sha256(bytes) };
    } catch { return { verified: false, reason: 'report_unreadable', reportSha256: null }; }
};
if (optionArguments[0] === '--verify-alert-report') {
    const result = verifyAlertReport(reportOption);
    console.log(JSON.stringify({ alertReport: result }));
    process.exit(result.verified ? 0 : 1);
}
if (process.argv.includes('--http-child')) {
    const fastify = require('fastify');
    const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
    const app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: any, reply: any) => {
        if (request.headers.authorization !== `Bearer ${process.env.AI_CAPACITY_HTTP_TOKEN}`)
            return reply.code(401).send({ errorCode: 'FIXTURE_AUTH' });
        request.userId = process.env.AI_CAPACITY_ACCOUNT_ID;
    });
    app.setErrorHandler((error: any, _request: any, reply: any) => {
        const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400
            ? error.statusCode : 500;
        if (status >= 500) {
            const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
                ? error.code : 'UNCLASSIFIED';
            process.stderr.write(`AI_CAPACITY_CHILD_HTTP_ERROR code=${code}\n`);
        }
        return reply.code(status).send({ errorCode: status >= 500 ? 'ROUTE_EXCEPTION'
            : 'REQUEST_REJECTED' });
    });
    const { aiExecutionEventRoutes } = await importRuntime(
        'packages/happy-server/sources/app/api/routes/aiExecutionEventRoutes');
    aiExecutionEventRoutes(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    process.stdout.write(`AI_CAPACITY_CHILD_READY ${address}\n`);
    process.once('SIGTERM', () => { void app.close().finally(() => process.exit(0)); });
} else {
const candidateBeforeSha256 = artifactContextFile ? candidateDigest() : null;
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error('DATABASE_URL is required');
const adminUrl = new URL(configured);
if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol)) throw new Error('PostgreSQL required');
const tag = randomBytes(8).toString('hex');
const databaseName = `happy_ai_capacity_${tag}`;
const roleName = `happy_ai_capacity_role_${tag}`;
const fixtureUrl = new URL(adminUrl);
fixtureUrl.pathname = `/${databaseName}`;
const serverCwd = join(runtimeRoot, 'packages/happy-server');
const admin = new PrismaClient();
let fixture: InstanceType<typeof PrismaClient> | null = null;
let created = false;
let roleCreated = false;
let httpApp: { close: () => Promise<unknown> } | null = null;
let saturationChild: ChildProcess | null = null;
let holdClient: InstanceType<typeof PrismaClient> | null = null;
let workerSocket: { close: () => void } | null = null;
let workerRpcIdentity: { accountId: string; machineId: string; method: string } | null = null;
const httpErrorCounts = new Map<string, number>();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
        cwd: serverCwd, env: { ...process.env, DATABASE_URL: fixtureUrl.toString() },
        encoding: 'utf8', timeout: 180_000, maxBuffer: 2_000_000,
    });
    assert.equal(migrated.status, 0, `Isolated migration exit ${migrated.status ?? 'signal'}`);
    process.env.DATABASE_URL = fixtureUrl.toString();
    fixture = new PrismaClient({ datasources: { db: { url: fixtureUrl.toString() } } });
    const account = await fixture.account.create({ data: { publicKey: `capacity-fixture-${tag}` } });
    const workspace = await fixture.aiWorkspace.create({ data: {
        ownerAccountId: account.id, name: `Capacity ${tag}`,
        members: { create: { memberAccountId: account.id, role: 'owner' } },
    } });
    const agent = await fixture.aiAgent.create({ data: { accountId: account.id,
        name: `capacity-${tag}`, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', permissionMode: 'read_only' } } });
    const conversation = await fixture.aiConversation.create({ data: { accountId: account.id,
        scopeKey: `capacity-${tag}`, kind: 'direct', agentId: agent.id, title: 'Capacity fixture' } });
    const run = await fixture.orchestratorRun.create({ data: { accountId: account.id,
        title: 'Capacity fixture', status: 'running', tasks: { create: {
            seq: 1, taskKey: 'capacity', provider: 'codex', prompt: 'Fixture', status: 'running',
        } } }, include: { tasks: true } });
    const execution = await fixture.orchestratorExecution.create({ data: {
        runId: run.id, taskId: run.tasks[0].id, machineId: `machine-${tag}`,
        provider: 'codex', status: 'running', dispatchToken: randomUUID(),
    } });
    const work = await fixture.aiWorkItem.create({ data: { accountId: account.id,
        title: 'Capacity fixture', summary: 'Fixture', sourceType: 'execution',
        sourceLabel: 'Fixture', sourceResourceId: run.id, assigneeId: agent.id,
        conversationId: conversation.id, orchestratorRunId: run.id,
        orchestratorTaskId: run.tasks[0].id } });
    const count = 200;
    const old = new Date(Date.now() - 31 * 24 * 60 * 60_000);
    const events = Array.from({ length: count }, (_, i) => ({ accountId: account.id,
        executionId: execution.id, eventId: `capacity-${i}`, seq: i + 1,
        kind: 'tool', phase: 'completed', occurredAt: old,
        redactedSummary: `fixture-${i}`, payloadHash: hash(`event-${i}`), createdAt: old }));
    const usage = Array.from({ length: count }, (_, i) => ({ accountId: account.id,
        executionId: execution.id, sourceEventId: `usage-${i}`, provider: 'codex',
        model: 'fixture', inputTokens: 1, outputTokens: 1, costMicros: 1n,
        measuredAt: new Date(), payloadHash: hash(`usage-${i}`) }));
    const decisions = Array.from({ length: count }, (_, i) => ({ accountId: account.id,
        workspaceId: workspace.id, workItemId: work.id, runId: run.id,
        taskId: run.tasks[0].id, executionId: execution.id,
        machineId: execution.machineId, dispatchTokenHash: hash(execution.dispatchToken),
        kind: 'approval', operationId: `capacity-${i}`, payload: { fixture: i },
        status: 'pending', deliveryStatus: 'pending', version: 1,
        expiresAt: new Date(Date.now() + 60_000) }));
    const started = performance.now();
    assert.equal((await fixture.aiPersistentExecutionEvent.createMany({ data: events })).count, count);
    assert.equal((await fixture.aiUsageDelta.createMany({ data: usage })).count, count);
    assert.equal((await fixture.aiDecisionRequest.createMany({ data: decisions })).count, count);
    const insertMs = Math.round(performance.now() - started);
    let duplicateRejected = false;
    try { await fixture.aiPersistentExecutionEvent.create({ data: events[0] }); }
    catch { duplicateRejected = true; }
    assert.equal(duplicateRejected, true);
    const page = await fixture.aiPersistentExecutionEvent.findMany({ where: {
        accountId: account.id, executionId: execution.id, seq: { gt: 100 } },
    orderBy: { seq: 'asc' }, take: 25 });
    assert.deepEqual(page.map((row: any) => row.seq), Array.from({ length: 25 }, (_, i) => i + 101));
    const plan = await fixture.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        'EXPLAIN SELECT * FROM "AiPersistentExecutionEvent" WHERE "accountId"=$1 AND "executionId"=$2 AND seq > 100 ORDER BY seq LIMIT 25',
        account.id, execution.id);
    const planText = plan.map((row) => row['QUERY PLAN']).join(' ');
    const measuredPlan = await fixture.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "AiPersistentExecutionEvent" WHERE "accountId"=$1 AND "executionId"=$2 AND seq > 100 ORDER BY seq LIMIT 25',
        account.id, execution.id);
    const executionTime = measuredPlan.map((row) => row['QUERY PLAN'])
        .find((line) => line.startsWith('Execution Time:')) ?? '';
    const queryMs = Number(executionTime.match(/Execution Time: ([\d.]+) ms/)?.[1]);
    assert.ok(Number.isFinite(queryMs), 'EXPLAIN ANALYZE did not report execution time');
    const otherPlans = await Promise.all([
        fixture.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
            'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "AiUsageDelta" WHERE "accountId"=$1 AND "executionId"=$2 ORDER BY "measuredAt" LIMIT 25',
            account.id, execution.id),
        fixture.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
            'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "AiDecisionRequest" WHERE "workspaceId"=$1 AND status=$2 ORDER BY "createdAt" DESC LIMIT 25',
            workspace.id, 'pending'),
    ]);
    const queryPlans = otherPlans.map((rows) => {
        const lines = rows.map((row) => row['QUERY PLAN']);
        const time = lines.find((line) => line.startsWith('Execution Time:')) ?? '';
        const ms = Number(time.match(/Execution Time: ([\d.]+) ms/)?.[1]);
        assert.ok(Number.isFinite(ms));
        return { index: lines.some((line) => line.includes('Index')), ms };
    });
    const fastify = require('fastify');
    const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
    const app = fastify({ logger: false });
    httpApp = app;
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: any, request: any, reply: any) => {
        const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400
            ? error.statusCode : 500;
        if (status >= 500) {
            const kind = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
                ? error.name.slice(0, 40) : 'UnknownError';
            const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
                ? error.code : 'UNCLASSIFIED';
            const frames = typeof error?.stack === 'string'
                ? error.stack.split('\n').slice(1, 4).map((line: string) => {
                    const match = line.match(/([^/\\\s()]+\.(?:ts|js|mjs)):(\d+):(\d+)/);
                    return match ? `${match[1]}:${match[2]}` : 'unknown';
                }) : [];
            const category = `${kind}/${code}`;
            const seen = httpErrorCounts.get(category) ?? 0;
            httpErrorCounts.set(category, seen + 1);
            if (seen === 0) console.error(`AI_CAPACITY_HTTP_ERROR kind=${kind} code=${code} frames=${frames.join(',')}`);
        }
        return reply.code(status).send({ errorCode: status >= 500 ? 'FIXTURE_ROUTE_EXCEPTION'
            : 'REQUEST_REJECTED' });
    });
    const httpToken = randomBytes(32).toString('hex');
    app.decorate('authenticate', async (request: any, reply: any) => {
        if (request.headers.authorization !== `Bearer ${httpToken}`)
            return reply.code(401).send({ error: 'Fixture authentication required' });
        request.userId = account.id;
    });
    const { aiExecutionEventRoutes } = await importRuntime(
        'packages/happy-server/sources/app/api/routes/aiExecutionEventRoutes');
    const { aiDecisionRoutes } = await importRuntime(
        'packages/happy-server/sources/app/api/routes/aiDecisionRoutes');
    aiExecutionEventRoutes(app);
    aiDecisionRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const getEvents = async (query: string) => fetch(
        `${base}/v1/ai-team/executions/${execution.id}/events?${query}`,
        { headers: { Authorization: `Bearer ${httpToken}` }, signal: AbortSignal.timeout(5000) });
    const httpPages: number[] = [];
    let cursor = 0;
    for (let i = 0; i < 4; i++) {
        const response = await getEvents(`afterSeq=${cursor}&limit=50`);
        assert.equal(response.status, 200);
        const body = await response.json() as { items: Array<{ seq: number }>;
            nextAfterSeq: number };
        assert.equal(body.items.length, 50);
        assert.equal(body.items[0].seq, cursor + 1);
        cursor = body.nextAfterSeq;
        httpPages.push(body.items.length);
    }
    assert.equal(cursor, count);
    const invalidLimit = await getEvents('afterSeq=0&limit=101');
    assert.equal(invalidLimit.status, 400);
    const oversizedEvent = await fetch(`${base}/v1/ai-team/executions/${execution.id}/events`, {
        method: 'POST', headers: { Authorization: `Bearer ${httpToken}`,
            'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: 'oversized', seq: count + 1,
            kind: 'tool', phase: 'completed', occurredAt: new Date().toISOString(),
            summary: 'x'.repeat(8_001), machineId: execution.machineId,
            capability: 'a'.repeat(64) }), signal: AbortSignal.timeout(5000),
    });
    assert.equal(oversizedEvent.status, 400);
    const decisionPages: number[] = [];
    const decisionIds = new Set<string>();
    let decisionCursor: string | null = null;
    for (let i = 0; i < 4; i++) {
        const response = await fetch(`${base}/v1/ai-team/decisions?status=pending&limit=50`
            + (decisionCursor ? `&cursor=${encodeURIComponent(decisionCursor)}` : ''), {
            headers: { Authorization: `Bearer ${httpToken}` }, signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200);
        const body = await response.json() as { items: Array<{ id: string }>;
            nextCursor: string | null };
        assert.equal(body.items.length, 50);
        for (const item of body.items) {
            assert.equal(decisionIds.has(item.id), false);
            decisionIds.add(item.id);
        }
        decisionCursor = body.nextCursor;
        decisionPages.push(body.items.length);
    }
    assert.equal(decisionIds.size, count);
    const burst = await Promise.all(Array.from({ length: 32 }, async () => {
        const start = performance.now();
        const response = await getEvents('afterSeq=100&limit=25');
        await response.arrayBuffer();
        return { status: response.status, ms: performance.now() - start };
    }));
    const sortedLatency = burst.map((row) => row.ms).sort((a, b) => a - b);
    const httpP95Ms = Math.round(sortedLatency[Math.ceil(sortedLatency.length * .95) - 1]);
    const httpStatusCounts = burst.reduce<Record<string, number>>((counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
    }, {});
    const backpressureObserved = burst.some((row) => row.status === 429 || row.status === 503);
    const unhandledOverload = burst.some((row) => row.status >= 500 && row.status !== 503);
    const { redactExpiredExecutionEvents } = await importRuntime('packages/happy-server/sources/app/ai/executionEvents');
    const retention = await redactExpiredExecutionEvents(new Date(), account.id);
    assert.equal(retention.count, count);
    assert.equal(await fixture.aiPersistentExecutionEvent.count({ where: {
        accountId: account.id, redactedAt: { not: null }, redactedSummary: '' } }), count);
    const policy = await fixture.aiBudgetPolicy.create({ data: { workspaceId: workspace.id,
        scopeKey: `capacity-${tag}`, periodStart: new Date(Date.now() - 60_000),
        periodEnd: new Date(Date.now() + 60_000), limitMicros: 100n,
        perRunReserveMicros: 15n, usedMicros: 80n, reservedMicros: 15n } });
    const budgetPercent = Number((policy.usedMicros + policy.reservedMicros) * 100n
        / policy.limitMicros);
    const { updateDatabaseMetrics, register } = await importRuntime('packages/happy-server/sources/app/monitoring/metrics2');
    await updateDatabaseMetrics();
    const metricText = await register.metrics();
    const fixedLabels = metricText.includes('ai_workflow_queue_items{queue="decision",status="pending"}')
        && ![account.id, workspace.id, run.id, execution.id]
            .some((identifier) => metricText.includes(identifier));
    const queueCount = await fixture.aiDecisionRequest.count({ where: {
        workspaceId: workspace.id, deliveryStatus: 'pending' } });
    const usageCount = await fixture.aiUsageDelta.count({ where: {
        accountId: account.id, executionId: execution.id } });
    assert.equal(queueCount, count); assert.equal(usageCount, count);
    assert.equal(fixedLabels, true, 'Metrics must expose fixed labels without tenant IDs');
    await fixture.aiDecisionRequest.updateMany({ where: { accountId: account.id },
        data: { status: 'decided', decidedBy: account.id, decision: 'approved' } });
    const { decisionOutboxTick } = await importRuntime('packages/happy-server/sources/app/ai/decisionOutbox');
    const tickStart = performance.now();
    await decisionOutboxTick(new Date(), account.id);
    const noRpcTickMs = Math.round(performance.now() - tickStart);
    const noRpcAttempts = await fixture.aiDecisionRequest.aggregate({ where: {
        accountId: account.id }, _sum: { attempts: true } });
    assert.equal(noRpcAttempts._sum.attempts, 0);
    let workerRpcVerified = false;
    let workerRpcAttempts = 0;
    let workerRpcAckCount = 0;
    if (workerRpcRequested) {
        const target = await fixture.aiDecisionRequest.findFirstOrThrow({ where: {
            accountId: account.id, deliveryStatus: 'pending' }, orderBy: { createdAt: 'asc' } });
        await fixture.aiDecisionRequest.updateMany({ where: { accountId: account.id,
            id: { not: target.id } }, data: { deliveryStatus: 'none' } });
        await fixture.aiDecisionRequest.update({ where: { id: target.id }, data: {
            operationId: null, expiresAt: new Date(Date.now() + 300_000),
            nextAttemptAt: new Date(Date.now() - 1000) } });
        await fixture.machine.create({ data: { id: execution.machineId, accountId: account.id,
            metadata: 'fixture-encrypted-metadata', dataEncryptionKey: randomBytes(32) } });
        const { auth } = await importRuntime('packages/happy-server/sources/app/auth/auth');
        const { startSocket } = await importRuntime('packages/happy-server/sources/app/api/socket');
        await auth.init();
        startSocket(app);
        const jwt = await auth.createToken(account.id);
        const method = `${execution.machineId}:orchestrator-decision`;
        workerRpcIdentity = { accountId: account.id, machineId: execution.machineId, method };
        const socketRequire = createRequire(join(runtimeRoot, 'packages/happy-cli/package.json'));
        const { io } = socketRequire('socket.io-client');
        const socket = io(base, { transports: ['websocket'], path: '/v1/updates',
            reconnection: false, auth: { token: jwt, clientType: 'machine-scoped',
                machineId: execution.machineId } });
        workerSocket = socket;
        socket.on('rpc-request', (body: { method: string; params: { decisionId: string;
            executionId: string; dispatchToken: string } }, ack: (value: unknown) => void) => {
            assert.equal(body.method, method);
            assert.equal(body.params.decisionId, target.id);
            assert.equal(body.params.executionId, execution.id);
            assert.equal(body.params.dispatchToken, execution.dispatchToken);
            workerRpcAckCount++;
            ack({ accepted: true });
        });
        await new Promise<void>((done, reject) => {
            const timer = setTimeout(() => reject(new Error('Owned machine Socket connect timeout')), 5000);
            socket.once('connect', () => { clearTimeout(timer); done(); });
            socket.once('connect_error', () => {
                clearTimeout(timer); reject(new Error('Owned machine Socket rejected')); });
        });
        const registered = new Promise<void>((done, reject) => {
            const timer = setTimeout(() => reject(new Error('Owned decision RPC register timeout')), 5000);
            socket.once('rpc-registered', (body: { method: string }) => {
                clearTimeout(timer);
                body.method === method ? done() : reject(new Error('Wrong decision RPC registered'));
            });
            socket.once('rpc-error', () => {
                clearTimeout(timer); reject(new Error('Owned decision RPC rejected')); });
        });
        socket.emit('rpc-register', { method });
        await registered;
        await Promise.all(Array.from({ length: 4 }, () => decisionOutboxTick(new Date(), account.id)));
        const delivered = await fixture.aiDecisionRequest.findUniqueOrThrow({ where: { id: target.id } });
        workerRpcAttempts = delivered.attempts;
        workerRpcVerified = delivered.deliveryStatus === 'delivered'
            && delivered.attempts === 1 && workerRpcAckCount === 1;
        await decisionOutboxTick(new Date(), account.id);
        const afterDuplicate = await fixture.aiDecisionRequest.findUniqueOrThrow({ where: { id: target.id } });
        workerRpcVerified = workerRpcVerified && afterDuplicate.attempts === 1
            && workerRpcAckCount === 1;
        assert.equal(workerRpcVerified, true, 'Actual Socket decision worker did not deliver once');
    }
    const metricLines = metricText.split('\n');
    const maxRatioLine = metricLines.find((line) => /^ai_budget_max_utilization_ratio\s/.test(line));
    const thresholdLine = metricLines.find((line) => /^ai_budget_policies_high_water\{[^}]*threshold="0\.9"[^}]*\}\s/.test(line));
    const sampleValue = (line?: string) => line ? Number(line.trim().split(/\s+/).at(-1)) : NaN;
    const highWaterMetricPresent = sampleValue(maxRatioLine) >= 0.95
        && sampleValue(thresholdLine) >= 1;
    const alertReport = verifyAlertReport(reportOption);
    const alertRulesVerified = alertReport.verified;
    const rolePassword = randomBytes(24).toString('hex');
    assert.match(roleName, /^happy_ai_capacity_role_[0-9a-f]{16}$/);
    await admin.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}' CONNECTION LIMIT 2`);
    roleCreated = true;
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${databaseName}" TO "${roleName}"`);
    await fixture.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
    await fixture.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${roleName}"`);
    const limitedUrl = new URL(fixtureUrl);
    limitedUrl.username = roleName;
    limitedUrl.password = rolePassword;
    limitedUrl.searchParams.set('connection_limit', '2');
    const holderUrl = new URL(limitedUrl);
    await fixture.$disconnect();
    const productionDb = (await importRuntime('packages/happy-server/sources/storage/db')).db;
    await productionDb.$disconnect();
    const childToken = randomBytes(32).toString('hex');
    const tsx = join(runtimeRoot, 'node_modules/.bin/tsx');
    saturationChild = spawn(tsx, ['--tsconfig', join(runtimeRoot,
        'packages/happy-server/tsconfig.json'),
        fileURLToPath(import.meta.url), '--http-child'], {
        cwd: serverCwd, env: { ...process.env, DATABASE_URL: limitedUrl.toString(),
            AI_CAPACITY_HTTP_TOKEN: childToken, AI_CAPACITY_ACCOUNT_ID: account.id },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childOutput = '';
    let childErrors = '';
    saturationChild.stdout!.setEncoding('utf8');
    saturationChild.stderr!.setEncoding('utf8');
    saturationChild.stdout!.on('data', (chunk: string) => { childOutput += chunk; });
    saturationChild.stderr!.on('data', (chunk: string) => { childErrors += chunk; });
    const childStarted = Date.now();
    while (!childOutput.includes('AI_CAPACITY_CHILD_READY ')) {
        if (saturationChild.exitCode !== null || Date.now() - childStarted > 10_000)
            throw new Error('Owned low-connection HTTP child did not start');
        await new Promise((done) => setTimeout(done, 25));
    }
    const childBase = childOutput.match(/AI_CAPACITY_CHILD_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    assert.ok(childBase);
    holdClient = new PrismaClient({ datasources: { db: { url: holderUrl.toString() } } });
    const holds = [1, 2].map(async () => await holdClient!.$queryRawUnsafe(
        'SELECT 1 AS held FROM pg_sleep(8)'));
    const holdStarted = Date.now();
    let activeHolders = 0;
    while (Date.now() - holdStarted < 4000) {
        const rows = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
            "SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND state='active'",
            databaseName, roleName);
        activeHolders = Number(rows[0].count);
        if (activeHolders === 2) break;
        await new Promise((done) => setTimeout(done, 50));
    }
    if (activeHolders !== 2) {
        const outcomes = await Promise.allSettled(holds);
        const codes = outcomes.map((item) => item.status === 'fulfilled' ? 'fulfilled'
            : typeof (item.reason as { code?: unknown })?.code === 'string'
                && /^[A-Z0-9_]{1,40}$/.test((item.reason as { code: string }).code)
                    ? (item.reason as { code: string }).code : 'UNCLASSIFIED');
        console.error(`AI_CAPACITY_HOLD_SETUP_FAILED active=${activeHolders} codes=${codes.join(',')}`);
    }
    assert.equal(activeHolders, 2, 'Owned role connection slots were not occupied');
    const saturated = await Promise.all(Array.from({ length: 8 }, async () => {
        try {
            const response = await fetch(`${childBase}/v1/ai-team/executions/${execution.id}/events?limit=1`, {
                headers: { Authorization: `Bearer ${childToken}` }, signal: AbortSignal.timeout(4500),
            });
            await response.arrayBuffer();
            return { status: response.status, retryAfter: response.headers.has('retry-after') };
        } catch { return { status: 0, retryAfter: false }; }
    }));
    await Promise.allSettled(holds);
    await holdClient.$disconnect(); holdClient = null;
    const recovered = await fetch(`${childBase}/v1/ai-team/executions/${execution.id}/events?limit=1`, {
        headers: { Authorization: `Bearer ${childToken}` }, signal: AbortSignal.timeout(5000),
    });
    const recoveryStatus = recovered.status;
    await recovered.arrayBuffer();
    const recoverySequences: number[] = [];
    let recoveryCursor = 0;
    for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
        const response = await fetch(`${childBase}/v1/ai-team/executions/${execution.id}/events?afterSeq=${recoveryCursor}&limit=50`, {
            headers: { Authorization: `Bearer ${childToken}` }, signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200, 'Recovered event page must be readable');
        const body = await response.json() as { items: Array<{ seq: number }>;
            nextAfterSeq: number | null };
        assert.equal(body.items.length, 50, 'Recovered event page must be complete');
        recoverySequences.push(...body.items.map((item) => item.seq));
        recoveryCursor = body.nextAfterSeq ?? recoveryCursor;
    }
    const recoveryPagesComplete = recoverySequences.length === count
        && recoverySequences.every((seq, index) => seq === index + 1);
    assert.equal(recoveryPagesComplete, true, 'Recovered event pagination must not lose or repeat rows');
    const saturatedStatusCounts = saturated.reduce<Record<string, number>>((counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
    }, {});
    const saturationBounded = saturated.some((row) => [429, 503].includes(row.status)
        && row.retryAfter) && saturated.every((row) => [429, 503].includes(row.status));
    const saturationUnhandled = saturated.some((row) => row.status === 500 || row.status === 0);
    const httpBackpressureVerified = activeHolders === 2 && saturationBounded
        && !saturationUnhandled && recoveryStatus === 200 && recoveryPagesComplete;
    const childErrorCodes = [...childErrors.matchAll(/AI_CAPACITY_CHILD_HTTP_ERROR code=([A-Z0-9_]+)/g)]
        .map((match) => match[1]);
    const candidateAfterSha256 = artifactContextFile ? candidateDigest() : null;
    const candidateStable = candidateBeforeSha256 === candidateAfterSha256;
    console.log(JSON.stringify({ fixture: 'isolated-db-no-provider', artifactContextSha256,
        sourceRoot, runtimeRoot,
        candidateBeforeSha256, candidateAfterSha256, candidateStable,
        insertMs, rowsEach: count,
        duplicateRejected, pageFirst: page[0].seq, pageLast: page.at(-1)?.seq,
        eventPlanIndex: planText.includes('Index'), queryMs,
        usagePlan: queryPlans[0], decisionPlan: queryPlans[1], httpPages, decisionPages,
        invalidLimitStatus: invalidLimit.status, oversizedEventStatus: oversizedEvent.status,
        httpBurst: burst.length,
        httpStatusCounts, httpP95Ms, backpressureObserved,
        unhandledOverload, httpErrorCounts: Object.fromEntries(httpErrorCounts),
        saturatedStatusCounts, activeHolders, saturationBounded, saturationUnhandled,
        recoveryStatus, recoveryPagesComplete, childErrorCodes: [...new Set(childErrorCodes)],
        retentionRedacted: retention.count,
        usageCount, pendingDecisionCount: queueCount, fixedLabels, noRpcTickMs,
        noRpcAttempts: noRpcAttempts._sum.attempts, budgetPercent,
        highWaterMetricPresent, alertRulesVerified, alertReport,
        httpBackpressureVerified,
        workerRpcVerified, workerRpcAttempts, workerRpcAckCount }));
    if (!planText.includes('Index') || !highWaterMetricPresent || !saturationBounded
        || saturationUnhandled || recoveryStatus !== 200
        || !alertRulesVerified || !candidateStable)
        process.exitCode = 1;
} finally {
    if (saturationChild) {
        saturationChild.kill('SIGTERM');
        if (saturationChild.exitCode === null && saturationChild.signalCode === null)
            await new Promise<void>((done) => saturationChild!.once('exit', () => done()));
    }
    workerSocket?.close();
    if (workerRpcIdentity && process.env.REDIS_URL) {
        const routeId = sha256(`${workerRpcIdentity.accountId}\0${workerRpcIdentity.method}`);
        const routeKey = `happy:rpc:route:v1:${routeId}`;
        const epochKey = `happy:rpc:epoch:v1:${routeId}`;
        const Redis = require('ioredis');
        const redis = new Redis(process.env.REDIS_URL);
        try {
            const route = await redis.get(routeKey);
            if (route) {
                const parsed = JSON.parse(route);
                assert.equal(parsed.accountId, workerRpcIdentity.accountId);
                assert.equal(parsed.method, workerRpcIdentity.method);
            }
            const removed = await redis.del(routeKey, epochKey);
            console.log(`AI_CAPACITY_WORKER_RPC_REDIS_CLEANUP exactKeys=2 removed=${removed}`);
        } finally { redis.disconnect(); }
        const { stopDistributedRpc } = await importRuntime('packages/happy-server/sources/app/api/socket/rpcRegistry');
        const { eventRouter } = await importRuntime('packages/happy-server/sources/app/events/eventRouter');
        await stopDistributedRpc();
        eventRouter.stopDistributed?.();
    }
    await holdClient?.$disconnect();
    await httpApp?.close();
    await fixture?.$disconnect();
    process.env.DATABASE_URL = configured;
    await admin.$disconnect();
    if (created) {
        const cleanup = new PrismaClient({ datasources: { db: { url: configured } } });
        try {
            assert.match(databaseName, /^happy_ai_capacity_[0-9a-f]{16}$/);
            await cleanup.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
            const residual = await cleanup.$queryRawUnsafe<Array<{ count: bigint }>>(
                'SELECT count(*)::bigint AS count FROM pg_database WHERE datname=$1', databaseName);
            assert.equal(Number(residual[0].count), 0);
            console.log('AI_CAPACITY_FIXTURE_CLEANUP databases=1 residual=0');
        } finally { await cleanup.$disconnect(); }
    }
    if (roleCreated) {
        const cleanupRole = new PrismaClient({ datasources: { db: { url: configured } } });
        try {
            assert.match(roleName, /^happy_ai_capacity_role_[0-9a-f]{16}$/);
            await cleanupRole.$executeRawUnsafe(`DROP ROLE "${roleName}"`);
            const residual = await cleanupRole.$queryRawUnsafe<Array<{ count: bigint }>>(
                'SELECT count(*)::bigint AS count FROM pg_roles WHERE rolname=$1', roleName);
            assert.equal(Number(residual[0].count), 0);
            console.log('AI_CAPACITY_ROLE_CLEANUP roles=1 residual=0');
        } finally { await cleanupRole.$disconnect(); }
    }
}
process.exit(process.exitCode ?? 0);
}
