import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { autopilotRunTick } from '../packages/happy-server/sources/app/ai/autopilot';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';

// Real DB scheduler race; no provider dispatch, HTTP, or GitHub writes.
// The project Git identity is fixture data and is not claimed as a real repo.
const tag = randomUUID(); let accountId = '';
const evidence: Array<{ policy: string; activeRuns: number; submitted: number }> = [];
try {
    accountId = (await db.account.create({ data: { publicKey: `autopilot-concurrency-${tag}` } })).id;
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId, metadata: '{}', active: true } });
    // Only routing availability is needed: submitWork creates durable queued
    // runs, and no scheduler/real RPC dispatch is started by this fixture.
    getOrCreateUserRpcListeners(accountId).set(`${machineId}:orchestrator-dispatch`, { connected: true } as any);
    const settings = { engine: 'codex', model: 'default', instructions: '', workingDirectory: '/owned-fixture', permissionMode: 'guarded_auto', allowDelegation: false };
    const agent = await db.aiAgent.create({ data: { accountId, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings } });
    const project = await db.aiProject.create({ data: { accountId, name: tag, clientRequestId: tag, versions: { create: {
        version: 1, kind: 'local', commonGitDirHash: 'c'.repeat(64), machineId,
        registeredRepoId: tag, registeredKvVersion: 0, workingDirectory: '/owned-fixture',
        defaultBranch: 'main', baseCommit: 'a'.repeat(40), snapshotHash: 'b'.repeat(64),
    } } } });
    for (const policy of ['skip', 'queue', 'replace']) {
        const conversation = await db.aiConversation.create({ data: { accountId, agentId: agent.id,
            scopeKey: `${tag}:${policy}`, kind: 'direct', title: policy } });
        const rule = await db.aiAutopilot.create({ data: { accountId, projectId: project.id, agentId: agent.id,
            conversationId: conversation.id, name: policy, prompt: 'Owned read-only acceptance fixture.',
            triggerKind: 'manual', action: 'run_only', concurrencyPolicy: policy, enabled: true,
            runs: { create: [0, 1].map((i) => ({ triggerKey: `manual:${tag}:${i}`, plannedAt: new Date(Date.now() - 1000) })) },
        } });
        await Promise.all(Array.from({ length: 4 }, () => autopilotRunTick(new Date(), accountId)));
        const planned = await db.aiAutopilotRun.findMany({ where: { autopilotId: rule.id } });
        const ids = planned.map((run) => run.orchestratorRunId).filter((id): id is string => !!id);
        const activeRuns = await db.orchestratorRun.count({ where: { accountId, id: { in: ids }, status: { in: ['queued', 'running', 'canceling'] } } });
        evidence.push({ policy, activeRuns, submitted: planned.filter((run) => run.status === 'submitted').length });
        assert.equal(activeRuns, 1, `${policy} must reserve and submit exactly one active run`);
        if (policy === 'skip') {
            assert.equal(planned.filter((run) => run.status === 'skipped').length, 1);
        } else {
            assert.equal(planned.filter((run) => run.status === 'pending').length, 1);
            if (policy === 'replace') {
                // A slow cancellation remains active. Additional workers
                // must not dispatch its replacement until it is terminal.
                await autopilotRunTick(new Date(), accountId);
                assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: { id: ids[0] } })).status, 'canceling');
                assert.equal(await db.orchestratorRun.count({ where: { accountId, idempotencyKey: { startsWith: `ai:${conversation.id}:` } } }), 1);
            }
            await db.orchestratorRun.update({ where: { id: ids[0] }, data: { status: 'cancelled' } });
            await Promise.all(Array.from({ length: 4 }, () => autopilotRunTick(new Date(), accountId)));
            const recovered = await db.aiAutopilotRun.findMany({ where: { autopilotId: rule.id } });
            const allIds = recovered.map((run) => run.orchestratorRunId).filter((id): id is string => !!id);
            assert.equal(new Set(allIds).size, 2, `${policy} must submit the waiting trigger after termination`);
            assert.equal(await db.orchestratorRun.count({ where: { accountId, id: { in: allIds },
                status: { in: ['queued', 'running', 'canceling'] } } }), 1);
        }
        await db.aiAutopilot.update({ where: { id: rule.id }, data: { enabled: false } });
    }
    console.log(JSON.stringify({ result: 'REAL_DB_AUTOPILOT_DIFFERENT_TRIGGER_CONCURRENCY', evidence }));
    assert.ok(evidence.every((item) => item.activeRuns <= 1), 'Concurrent different triggers bypassed per-rule skip/queue concurrency policy');
    assert.ok(evidence.every((item) => item.activeRuns === 1), 'Fixture must actually submit one durable execution run');
    console.log('REAL_DB_AUTOPILOT_PER_RULE_CONCURRENCY_FENCED_OK');
} finally {
    if (accountId) {
        getOrCreateUserRpcListeners(accountId).clear();
        await db.aiAutopilot.deleteMany({ where: { accountId } });
        await db.orchestratorRun.deleteMany({ where: { accountId } });
        await db.aiConversation.deleteMany({ where: { accountId } });
        await db.aiProject.deleteMany({ where: { accountId } });
        await db.aiAgent.deleteMany({ where: { accountId } });
        await db.machine.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId, publicKey: `autopilot-concurrency-${tag}` } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
    }
    await db.$disconnect(); redis.disconnect();
}
