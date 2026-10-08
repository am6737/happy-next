import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { autopilotRunTick } from '../packages/happy-server/sources/app/ai/autopilot';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';

// Real DB lock pauses the actual worker after its initial owner check but
// before submitWork. Revoke its durable lease, release the lock, and ensure
// the stale worker cannot create a queued execution. No provider/GitHub.
const tag = randomUUID(); let accountId = '';
const phase = process.argv[2] ?? 'before-submit';
assert.ok(['before-submit', 'during-submit', 'during-expiry'].includes(phase));
let releaseLock: (() => void) | undefined;
let lockTask: Promise<unknown> | undefined; let worker: Promise<void> | undefined;
try {
    accountId = (await db.account.create({ data: { publicKey: `autopilot-lost-lease-${tag}` } })).id;
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId, metadata: '{}', active: true } });
    getOrCreateUserRpcListeners(accountId).set(`${machineId}:orchestrator-dispatch`, { connected: true } as any);
    const agent = await db.aiAgent.create({ data: { accountId, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', model: 'default', instructions: '', workingDirectory: '/owned-fixture', permissionMode: 'read_only', allowDelegation: false } } });
    const project = await db.aiProject.create({ data: { accountId, name: tag, clientRequestId: tag,
        versions: { create: { version: 1, kind: 'local', commonGitDirHash: 'c'.repeat(64), machineId,
            registeredRepoId: tag, registeredKvVersion: 0, workingDirectory: '/owned-fixture', defaultBranch: 'main',
            baseCommit: 'a'.repeat(40), snapshotHash: 'b'.repeat(64) } } } });
    const conversation = await db.aiConversation.create({ data: { accountId, agentId: agent.id, scopeKey: tag, kind: 'direct', title: tag } });
    const rule = await db.aiAutopilot.create({ data: { accountId, projectId: project.id, agentId: agent.id,
        conversationId: conversation.id, name: tag, prompt: 'Owned lease acceptance fixture',
        triggerKind: 'manual', action: 'run_only', concurrencyPolicy: 'queue', enabled: true,
        runs: { create: { triggerKey: `manual:${tag}`, plannedAt: new Date(Date.now() - 1000) } } }, include: { runs: true } });
    const planned = rule.runs[0];
    const key = { accountId, conversationId: conversation.id, clientMessageId: planned.id };
    await db.aiInboundRequest.create({ data: { ...key, status: 'failed', payloadHash: createHash('sha256')
        .update(JSON.stringify({ action: 'autopilot', autopilotId: rule.id, runId: planned.id })).digest('hex') } });
    let readyLock!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => { readyLock = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    lockTask = db.$transaction(async (tx) => {
        if (phase !== 'before-submit') {
            await tx.$queryRaw`SELECT id FROM "AiConversation" WHERE id=${conversation.id} AND "accountId"=${accountId} FOR NO KEY UPDATE`;
        } else {
            await tx.$queryRaw`SELECT "accountId" FROM "AiInboundRequest" WHERE "accountId"=${accountId} AND "conversationId"=${conversation.id} AND "clientMessageId"=${planned.id} FOR UPDATE`;
        }
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        readyLock(pid); await release;
    }, { timeout: 30_000 });
    const blockerPid = await ready;
    worker = autopilotRunTick(new Date(), accountId);
    let blocked = false;
    for (let i = 0; i < 200; i++) {
        const queryPattern = phase !== 'before-submit' ? '%AiConversation%' : '%AiInboundRequest%';
        const [{ count }] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE state='active' AND ${blockerPid} = ANY(pg_blocking_pids(pid)) AND query LIKE ${queryPattern}`;
        if (Number(count) > 0) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(blocked, 'Actual worker never reached the owned database lock');
    const processing = await db.aiAutopilotRun.findUniqueOrThrow({ where: { id: planned.id } });
    assert.equal(processing.status, 'processing'); assert.ok(processing.claimOwner);
    // Force expiration/revocation in durable state instead of a minute-long
    // wall-clock wait. This must fence already in-flight old-owner work.
    await db.aiAutopilotRun.update({ where: { id: planned.id }, data: phase === 'during-expiry'
        ? { leaseUntil: new Date(Date.now() - 1) }
        : { status: 'failed', errorCode: 'fixture_owner_revoked', claimOwner: null,
            leaseUntil: new Date(Date.now() - 1000) } });
    releaseLock(); await lockTask; await worker;
    const runs = await db.orchestratorRun.count({ where: { accountId } });
    const workItems = await db.aiWorkItem.count({ where: { accountId } });
    console.log(JSON.stringify({ result: 'REAL_DB_AUTOPILOT_REVOKED_OWNER_SIDE_EFFECTS', phase, runs, workItems }));
    assert.equal(runs, 0, 'Stale Autopilot owner created an execution after losing its durable lease');
    assert.equal(workItems, 0);
    console.log('REAL_DB_AUTOPILOT_LOST_OWNER_CANNOT_SUBMIT_OK');
} finally {
    releaseLock?.(); await lockTask?.catch(() => {}); await worker?.catch(() => {});
    if (accountId) {
        getOrCreateUserRpcListeners(accountId).clear();
        await db.aiAutopilot.deleteMany({ where: { accountId } });
        await db.aiInboundRequest.deleteMany({ where: { accountId } });
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.aiConversation.deleteMany({ where: { accountId } });
        await db.aiProject.deleteMany({ where: { accountId } });
        await db.aiAgent.deleteMany({ where: { accountId } });
        await db.machine.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId, publicKey: `autopilot-lost-lease-${tag}` } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
    }
    await db.$disconnect(); redis.disconnect();
}
