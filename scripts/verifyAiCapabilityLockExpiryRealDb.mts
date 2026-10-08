import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { issueExecutionCapability } from '../packages/happy-server/sources/app/ai/workspaceAuth';
import { recordExecutionEvent } from '../packages/happy-server/sources/app/ai/executionEvents';

// Real wall-clock expiry while the actual event transaction waits on a row
// lock. No credential/provider/daemon fixtures; only this random account.
const tag = randomUUID(); let accountId = '';
let releaseLock: (() => void) | undefined;
let blocker: Promise<unknown> | undefined;
let pending: Promise<unknown> | undefined;
try {
    accountId = (await db.account.create({ data: { publicKey: `cap-lock-expiry-${tag}` } })).id;
    const run = await db.orchestratorRun.create({ data: { accountId, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'primary', provider: 'codex', prompt: 'Owned fixture', status: 'running' } } },
        include: { tasks: true } });
    const machineId = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId, provider: 'codex', status: 'running', dispatchToken: randomUUID() } });
    const expiresAt = new Date(Date.now() + 2000);
    const capability = await issueExecutionCapability({ accountId, executionId: execution.id,
        allowedOps: ['event'], expiresAt });
    let ready!: (pid: number) => void;
    const locked = new Promise<number>(resolve => { ready = resolve; });
    const released = new Promise<void>(resolve => { releaseLock = resolve; });
    blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AiExecutionCapability" WHERE id=${capability.id} FOR UPDATE`;
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        ready(pid); await released;
    }, { timeout: 15000 });
    const blockerPid = await locked;
    let accepted = false;
    pending = recordExecutionEvent({ accountId, executionId: execution.id, machineId,
        capability: capability.token, eventId: tag, seq: 1, kind: 'tool', phase: 'completed',
        occurredAt: new Date(), summary: 'Owned lock-expiry fixture' })
        .then(() => { accepted = true; }, () => {});
    let blocked = false;
    for (let i = 0; i < 100; i++) {
        const [{ count }] = await db.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*) FROM pg_stat_activity WHERE state='active'
            AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%AiExecutionCapability%'`;
        if (Number(count)) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(blocked, 'Actual capability transaction did not reach the owned lock');
    assert.ok(Date.now() < expiresAt.getTime(), 'Fixture did not block before expiry');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 150)));
    releaseLock(); await blocker; await pending;
    const events = await db.aiPersistentExecutionEvent.count({ where: { executionId: execution.id } });
    console.log(JSON.stringify({ result: 'REAL_DB_CAPABILITY_LOCK_WAIT_EXPIRY', accepted, events }));
    assert.equal(accepted, false, 'Expired capability accepted after actual lock wait');
    assert.equal(events, 0, 'Expired capability wrote a persistent event');
    console.log('REAL_DB_CAPABILITY_EXPIRES_DURING_LOCK_WAIT_NO_SIDE_EFFECT_OK');
} finally {
    releaseLock?.(); await blocker?.catch(() => {}); await pending?.catch(() => {});
    if (accountId) {
        await db.aiPersistentExecutionEvent.deleteMany({ where: { accountId } });
        await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId, publicKey: `cap-lock-expiry-${tag}` } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
    }
    await db.$disconnect(); redis.disconnect();
}
