import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { planAutopilotCronTick } from '../packages/happy-server/sources/app/ai/autopilot';

// Actual persisted planner, four concurrent ticks. Fixed UTC expectations
// independently specify cron-parser's DST policy: nonexistent 02:30 shifts
// to 03:30; repeated 01:30 runs once at its first occurrence. No dispatch.
const tag = randomUUID(); let accountId = '';
try {
    accountId = (await db.account.create({ data: { publicKey: `autopilot-cron-${tag}` } })).id;
    const cases = [
        { name: 'spring', cron: '30 2 * * *', last: '2026-03-07T08:00:00Z', now: '2026-03-09T08:00:00Z',
            expected: ['2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z'] },
        { name: 'fall', cron: '30 1 * * *', last: '2026-10-31T08:00:00Z', now: '2026-11-02T08:00:00Z',
            expected: ['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'] },
    ];
    for (const item of cases) {
        const rule = await db.aiAutopilot.create({ data: { accountId, projectId: `fixture-${tag}`, agentId: `fixture-${tag}`,
            conversationId: `fixture-${tag}`, name: item.name, prompt: 'Planner fixture', triggerKind: 'cron',
            cronExpression: item.cron, timezone: 'America/New_York', lastPlannedAt: new Date(item.last),
            action: 'run_only', concurrencyPolicy: 'queue', catchupLimit: 5, enabled: true } });
        const now = new Date(item.now);
        await Promise.all(Array.from({ length: 4 }, () => planAutopilotCronTick(now, accountId)));
        const rows = await db.aiAutopilotRun.findMany({ where: { autopilotId: rule.id }, orderBy: { plannedAt: 'asc' } });
        assert.deepEqual(rows.map((row) => row.plannedAt.toISOString()), item.expected);
        assert.deepEqual(rows.map((row) => row.triggerKey), item.expected.map((date) => `cron:${date}`));
        await planAutopilotCronTick(now, accountId);
        assert.equal(await db.aiAutopilotRun.count({ where: { autopilotId: rule.id } }), 2);
        await db.aiAutopilot.update({ where: { id: rule.id }, data: { enabled: false } });
        await planAutopilotCronTick(new Date(now.getTime() + 86400000), accountId);
        assert.equal(await db.aiAutopilotRun.count({ where: { autopilotId: rule.id } }), 2);
    }
    console.log('REAL_DB_AUTOPILOT_CRON_DST_FOUR_WORKERS_REPLAY_AND_DISABLE_OK');
} finally {
    if (accountId) {
        await db.aiAutopilot.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId, publicKey: `autopilot-cron-${tag}` } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
    }
    await db.$disconnect(); redis.disconnect();
}
