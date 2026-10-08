import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integrationExpectedHash } from '../packages/happy-server/sources/app/ai/integrationHash';

// Run with happy-server/.env.dev. Never dump the configured shared database:
// both source and destination are random databases created by this process.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error('DATABASE_URL is required');
const url = new URL(configured);
if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('PostgreSQL URL is required');
const tag = randomBytes(8).toString('hex');
const prefix = `happy_ai_restore_${tag}`;
const sourceName = `${prefix}_source`;
const targetName = `${prefix}_target`;
const archiveDir = mkdtempSync(join(tmpdir(), 'happy-ai-restore-'));
const image = 'postgres:16-alpine';
const pgEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const created: string[] = [];
let source: InstanceType<typeof PrismaClient> | null = null;
let target: InstanceType<typeof PrismaClient> | null = null;

function databaseUrl(name: string) {
    const copy = new URL(url);
    copy.pathname = `/${name}`;
    return copy.toString();
}
function client(args: string[], input?: string) {
    const result = spawnSync('docker', ['run', '--rm', '-i', '--network', 'host',
        '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD',
        '-v', `${archiveDir}:/work`, image, ...args],
    { env: pgEnv, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000 });
    if (result.status !== 0) {
        const diagnostic = (result.stderr ?? '').split('\n')
            .filter((line) => line.startsWith('pg_restore: error:') || line.startsWith('pg_dump: error:') || line.startsWith('psql: error:'))
            .map((line) => line.replaceAll(configured, '[redacted-url]')
                .replaceAll(url.password ? decodeURIComponent(url.password) : '\0', '[redacted]'))
            .slice(0, 3).join(' | ').slice(0, 800);
        throw new Error(`PostgreSQL client command failed (${args[0]}, exit ${result.status ?? 'signal'}): ${diagnostic}`);
    }
}
function maintenance(sql: string) {
    client(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], sql);
}
function databaseExists(name: string) {
    const result = spawnSync('docker', ['run', '--rm', '--network', 'host',
        '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD', image,
        'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
        '-c', `SELECT 1 FROM pg_database WHERE datname = '${name}'`],
    { env: pgEnv, encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) throw new Error('Database existence check failed');
    return result.stdout.trim() === '1';
}
function assertOwned(name: string) {
    if (!new RegExp(`^happy_ai_restore_[0-9a-f]{16}_(source|target)$`).test(name)
        || !name.startsWith(prefix)) throw new Error('Refusing to touch a non-fixture database');
}

try {
    client(['pg_dump', '--version']);
    client(['pg_restore', '--version']);
    for (const name of [sourceName, targetName]) {
        assertOwned(name);
        maintenance(`CREATE DATABASE "${name}";`);
        created.push(name);
        assert.equal(databaseExists(name), true, 'Fixture database was not created');
    }
    const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
        cwd: new URL('../packages/happy-server/', import.meta.url),
        env: { ...process.env, DATABASE_URL: databaseUrl(sourceName) },
        encoding: 'utf8', timeout: 180_000, maxBuffer: 2_000_000,
    });
    if (migrated.status !== 0) throw new Error(`Isolated Prisma migration failed (exit ${migrated.status ?? 'signal'})`);
    source = new PrismaClient({ datasources: { db: { url: databaseUrl(sourceName) } } });
    const publicKey = `restore-fixture-${tag}`;
    const account = await source.account.create({ data: { publicKey } });
    const run = await source.orchestratorRun.create({ data: { accountId: account.id,
        title: 'Owned restore fixture', status: 'running', tasks: { create: {
            seq: 1, taskKey: 'aggregate', provider: 'codex', prompt: 'fixture', status: 'running',
        } } }, include: { tasks: true } });
    const task = run.tasks[0];
    const execution = await source.orchestratorExecution.create({ data: { runId: run.id,
        taskId: task.id, machineId: `machine-${tag}`, provider: 'codex',
        dispatchToken: randomUUID(), status: 'completed', finishedAt: new Date() } });
    const activeTask = await source.orchestratorTask.create({ data: { runId: run.id,
        seq: 2, taskKey: 'active', provider: 'codex', prompt: 'fixture', status: 'running' } });
    const activeExecution = await source.orchestratorExecution.create({ data: { runId: run.id,
        taskId: activeTask.id, machineId: `machine-${tag}`, provider: 'codex',
        dispatchToken: randomUUID(), status: 'running', attempt: 2 } });
    const workspace = await source.aiWorkspace.create({ data: {
        ownerAccountId: account.id, name: 'Owned restore workspace', authRevision: 3,
        members: { create: { memberAccountId: account.id, role: 'owner' } },
    } });
    const agent = await source.aiAgent.create({ data: { accountId: account.id,
        name: `restore-agent-${tag}`, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', permissionMode: 'read_only' } } });
    const conversation = await source.aiConversation.create({ data: { accountId: account.id,
        scopeKey: `restore-${tag}`, kind: 'direct', agentId: agent.id, title: 'Owned restore conversation' } });
    const work = await source.aiWorkItem.create({ data: { accountId: account.id,
        title: 'Owned restore work', summary: 'Fixture', sourceType: 'execution',
        sourceLabel: 'Fixture', sourceResourceId: run.id, assigneeId: agent.id,
        conversationId: conversation.id, orchestratorRunId: run.id, orchestratorTaskId: activeTask.id } });
    const capabilityToken = randomBytes(32).toString('hex');
    const capabilityExpiry = new Date(Date.now() + 10 * 60_000);
    const capability = await source.aiExecutionCapability.create({ data: {
        tokenHash: createHash('sha256').update(capabilityToken).digest('hex'),
        workspaceId: workspace.id, accountId: account.id, runId: run.id,
        taskId: activeTask.id, executionId: activeExecution.id, machineId: activeExecution.machineId,
        allowedOps: ['event', 'usage', 'decision_request'], authRevision: workspace.authRevision,
        expiresAt: capabilityExpiry,
    } });
    const budget = await source.aiBudgetPolicy.create({ data: { workspaceId: workspace.id,
        scopeKey: `restore-${tag}`, periodStart: new Date(Date.now() - 60_000),
        periodEnd: new Date(Date.now() + 60 * 60_000), limitMicros: 100n,
        perRunReserveMicros: 11n, reservedMicros: 11n, revision: 2,
        reservations: { create: { runId: run.id, reserveMicros: 11n,
            policyRevision: 2, status: 'reserved' } },
    }, include: { reservations: true } });
    const decision = await source.aiDecisionRequest.create({ data: { accountId: account.id,
        workspaceId: workspace.id, workItemId: work.id, runId: run.id, taskId: activeTask.id,
        executionId: activeExecution.id, machineId: activeExecution.machineId,
        dispatchTokenHash: createHash('sha256').update(activeExecution.dispatchToken).digest('hex'),
        kind: 'approval', payload: { summary: 'Owned restore fixture' },
        status: 'pending', version: 1, expiresAt: new Date(Date.now() + 60 * 60_000),
    } });
    const claimOwner = randomUUID();
    const leaseUntil = new Date(Date.now() + 120_000);
    await source.aiInboundRequest.create({ data: { accountId: account.id,
        conversationId: `conversation-${tag}`, clientMessageId: `message-${tag}`,
        payloadHash: createHash('sha256').update(JSON.stringify({ fixture: tag })).digest('hex'),
        status: 'processing', claimOwner, leaseUntil } });
    const expected = { fixture: tag, executionId: execution.id };
    const expectedHash = integrationExpectedHash(expected);
    await source.aiIntegrationVerification.create({ data: { executionId: execution.id,
        accountId: account.id, runId: run.id, taskId: task.id, machineId: `machine-${tag}`,
        proof: { fixture: tag }, expected, expectedHash, status: 'pending', attempts: 0 } });
    await source.$disconnect(); source = null;

    client(['pg_dump', '-Fc', '--no-owner', '--no-acl', '-f', '/work/fixture.dump', '-d', sourceName]);
    client(['pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-d', targetName, '/work/fixture.dump']);
    target = new PrismaClient({ datasources: { db: { url: databaseUrl(targetName) } } });
    const restoredAccount = await target.account.findUniqueOrThrow({ where: { id: account.id } });
    const restoredInbound = await target.aiInboundRequest.findUniqueOrThrow({ where: {
        accountId_conversationId_clientMessageId: { accountId: account.id,
            conversationId: `conversation-${tag}`, clientMessageId: `message-${tag}` } } });
    const restoredVerification = await target.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
    const restoredExecution = await target.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
    const restoredTask = await target.orchestratorTask.findUniqueOrThrow({ where: { id: task.id } });
    const restoredWorkspace = await target.aiWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });
    const restoredMembership = await target.aiWorkspaceMembership.findUniqueOrThrow({ where: {
        workspaceId_memberAccountId: { workspaceId: workspace.id, memberAccountId: account.id } } });
    const restoredCapability = await target.aiExecutionCapability.findUniqueOrThrow({ where: { id: capability.id } });
    const restoredBudget = await target.aiBudgetPolicy.findUniqueOrThrow({ where: { id: budget.id },
        include: { reservations: true } });
    const restoredDecision = await target.aiDecisionRequest.findUniqueOrThrow({ where: { id: decision.id } });
    assert.equal(restoredAccount.publicKey, publicKey);
    assert.equal(restoredInbound.status, 'processing');
    assert.equal(restoredInbound.claimOwner, claimOwner);
    assert.equal(restoredInbound.leaseUntil?.getTime(), leaseUntil.getTime());
    assert.equal(restoredVerification.status, 'pending');
    assert.equal(restoredVerification.expectedHash, expectedHash);
    assert.equal(restoredVerification.attempts, 0);
    assert.equal(restoredExecution.status, 'completed');
    assert.equal(restoredTask.status, 'running');
    assert.equal(restoredWorkspace.authRevision, 3);
    assert.equal(restoredMembership.role, 'owner');
    assert.equal(restoredCapability.tokenHash, createHash('sha256').update(capabilityToken).digest('hex'));
    assert.equal(restoredCapability.authRevision, restoredWorkspace.authRevision);
    assert.deepEqual(restoredCapability.allowedOps, ['event', 'usage', 'decision_request']);
    assert.equal(restoredCapability.expiresAt.getTime(), capabilityExpiry.getTime());
    assert.equal(restoredBudget.revision, 2);
    assert.equal(restoredBudget.reservedMicros, 11n);
    assert.equal(restoredBudget.reservations.length, 1);
    assert.equal(restoredBudget.reservations[0].status, 'reserved');
    assert.equal(restoredBudget.reservations[0].reserveMicros, 11n);
    assert.equal(restoredDecision.status, 'pending');
    assert.equal(restoredDecision.version, 1);
    assert.equal(restoredDecision.deliveryStatus, 'none');
    assert.equal(restoredDecision.dispatchTokenHash,
        createHash('sha256').update(activeExecution.dispatchToken).digest('hex'));
    console.log('AI_TEAM_RESTORED_P3_DURABLE_STATE_OK decision=pending budget=reserved capabilityRevision=3');
    console.log('AI_TEAM_ISOLATED_DATABASE_RESTORE_OK inbound=processing lease=preserved integration=pending execution=completed task=running');

    // Import the actual workers only after redirecting their shared db singleton
    // to the restored fixture database. Nothing in this process points them at handy.
    process.env.DATABASE_URL = databaseUrl(targetName);
    const { db: workerDb } = await import('../packages/happy-server/sources/storage/db');
    const { claimInbound, failInbound } = await import('../packages/happy-server/sources/app/api/routes/aiInboundRequest');
    const { integrationVerificationTick } = await import('../packages/happy-server/sources/app/ai/integrationVerification');
    const { verifyExecutionCapability } = await import('../packages/happy-server/sources/app/ai/workspaceAuth');
    const { settleAiBudgetTick } = await import('../packages/happy-server/sources/app/ai/budget');
    const { decisionOutboxTick } = await import('../packages/happy-server/sources/app/ai/decisionOutbox');
    const { getOrCreateUserRpcListeners } = await import('../packages/happy-server/sources/app/api/socket/rpcRegistry');
    try {
        assert.equal(await verifyExecutionCapability({ token: capabilityToken,
            accountId: account.id, executionId: activeExecution.id,
            machineId: activeExecution.machineId, operation: 'event' }), true);
        await settleAiBudgetTick(account.id);
        await decisionOutboxTick(new Date(), account.id);
        assert.equal((await target.aiBudgetReservation.findUniqueOrThrow({ where: {
            id: budget.reservations[0].id } })).status, 'reserved');
        assert.equal((await target.aiDecisionRequest.findUniqueOrThrow({ where: {
            id: decision.id } })).status, 'pending');
        await target.aiWorkspace.update({ where: { id: workspace.id },
            data: { authRevision: { increment: 1 } } });
        assert.equal(await verifyExecutionCapability({ token: capabilityToken,
            accountId: account.id, executionId: activeExecution.id,
            machineId: activeExecution.machineId, operation: 'event' }), false);
        console.log('AI_TEAM_RESTORED_P3_WORKER_AND_REVOCATION_OK pendingDecision=true reservedBudget=true oldCapability=denied');
        await Promise.all(Array.from({ length: 4 }, () => integrationVerificationTick(new Date(), account.id)));
        const offline = await target.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
        assert.equal(offline.status, 'pending');
        assert.equal(offline.attempts, 0);
        assert.equal((await target.orchestratorTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'running');
        assert.equal((await target.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'running');
        console.log('AI_TEAM_RESTORED_PENDING_NO_RPC_OK ticks=4 attempts=0 noCompletion=true');

        const key = { accountId: account.id, conversationId: `conversation-${tag}`, clientMessageId: `message-${tag}` };
        assert.equal((await claimInbound(key, { fixture: tag })).kind, 'processing');
        await target.aiInboundRequest.update({ where: { accountId_conversationId_clientMessageId: key },
            data: { leaseUntil: new Date(Date.now() - 1_000) } });
        const reclaimed = await claimInbound(key, { fixture: tag });
        assert.equal(reclaimed.kind, 'claimed');
        if (reclaimed.kind !== 'claimed') throw new Error('Inbound lease was not reclaimed');
        assert.notEqual(reclaimed.claim.claimOwner, claimOwner);
        await failInbound({ ...key, claimOwner });
        const afterOldInbound = await target.aiInboundRequest.findUniqueOrThrow({ where: { accountId_conversationId_clientMessageId: key } });
        assert.equal(afterOldInbound.status, 'processing');
        assert.equal(afterOldInbound.claimOwner, reclaimed.claim.claimOwner);
        await failInbound(reclaimed.claim);
        assert.equal((await target.aiInboundRequest.findUniqueOrThrow({ where: { accountId_conversationId_clientMessageId: key } })).status, 'failed');

        const oldVerificationOwner = randomUUID();
        await target.aiIntegrationVerification.update({ where: { executionId: execution.id },
            data: { status: 'processing', claimOwner: oldVerificationOwner,
                leaseUntil: new Date(Date.now() - 1_000) } });
        const method = `machine-${tag}:orchestrator-verify-integration`;
        let oldOwnerDenied = false;
        getOrCreateUserRpcListeners(account.id).set(method, {
            connected: true,
            timeout: () => ({ emitWithAck: async () => {
                const stale = await target!.aiIntegrationVerification.updateMany({ where: {
                    executionId: execution.id, status: 'processing', claimOwner: oldVerificationOwner,
                }, data: { status: 'verified' } });
                oldOwnerDenied = stale.count === 0;
                return { verified: false, errorCode: 'runtime_rejected' };
            } }),
        } as any);
        await integrationVerificationTick(new Date(), account.id);
        const recovered = await target.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
        assert.equal(oldOwnerDenied, true);
        assert.equal(recovered.status, 'pending');
        assert.equal(recovered.attempts, 1);
        assert.equal(recovered.claimOwner, null);
        assert.equal((await target.orchestratorTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'running');
        assert.equal((await target.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'running');
        console.log('AI_TEAM_RESTORED_EXPIRED_LEASE_FENCED_OK inbound=reclaimed oldOwner=denied verificationAttempts=1 noCompletion=true mockRpc=rejected');
    } finally {
        getOrCreateUserRpcListeners(account.id).clear();
        await workerDb.$disconnect();
    }
} finally {
    await source?.$disconnect();
    await target?.$disconnect();
    const ownedDatabases = [...created];
    for (const name of created.reverse()) {
        assertOwned(name);
        maintenance(`DROP DATABASE "${name}" WITH (FORCE);`);
        assert.equal(databaseExists(name), false, 'Fixture database was not removed');
    }
    rmSync(archiveDir, { recursive: true, force: true });
    console.log(`FIXTURE_CLEANUP databases=${ownedDatabases.length} residual=0 archive=removed`);
}
