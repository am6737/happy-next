import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { orchestratorSchedulerTick, ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS } from '../packages/happy-server/sources/app/orchestrator/scheduler';

// Real PostgreSQL and HTTP, natural fallback deadline; deliberately no daemon.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `watchdog-fallback-${randomUUID()}`;
let account: string | undefined;
app.decorate('authenticate', async (request: any, reply: any) => {
    if (request.headers['x-fixture-account'] !== account) return reply.code(401).send({ error: 'fixture' });
    request.userId = account;
});
try {
    account = (await db.account.create({ data: { publicKey: tag } })).id;
    const token = randomUUID(), timeoutMs = 1000, startedAt = new Date();
    const run = await db.orchestratorRun.create({ data: { accountId: account, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'missing-watchdog', provider: 'codex', prompt: '', status: 'running',
            retryMaxAttempts: 3, targetMachineId: tag } },
    }, include: { tasks: true } });
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId: tag, provider: 'codex', status: 'running',
        dispatchToken: token, startedAt, timeoutMs } });
    orchestratorRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (dispatchToken: string) => fetch(`${base}/v1/orchestrator/executions/${execution.id}/finish`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: {
            'content-type': 'application/json', 'x-fixture-account': account! },
        body: JSON.stringify({ dispatchToken, status: 'completed', exitCode: 0, finalResponse: 'Late unconfirmed result' }),
    });
    assert.ok(ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS > 0 && ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS <= 60000);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, startedAt.getTime() + timeoutMs + 100 - Date.now())));
    await orchestratorSchedulerTick(new Date(), account);
    assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).status, 'running',
        'Server fallback raced the original daemon watchdog deadline');
    console.log('WAITING_FOR_NATURAL_WATCHDOG_REPORT_GRACE');
    await new Promise(resolve => setTimeout(resolve, Math.max(0,
        startedAt.getTime() + timeoutMs + ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS + 300 - Date.now())));
    await orchestratorSchedulerTick(new Date(), account);
    const after = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id }, include: { tasks: true, executions: true } });
    assert.equal(after.status, 'failed'); assert.equal(after.tasks[0].status, 'failed');
    assert.equal(after.tasks[0].nextAttemptAt, null); assert.equal(after.executions[0].status, 'timeout');
    assert.equal(after.executions[0].errorCode, 'TASK_TIMEOUT'); assert.equal(after.executions.length, 1);
    assert.equal((await post(randomUUID())).status, 409, 'Wrong token bypassed terminal fencing');
    const late = await post(token); assert.ok([200, 409].includes(late.status));
    await orchestratorSchedulerTick(new Date(), account);
    const fenced = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id }, include: { tasks: true, executions: true } });
    assert.equal(fenced.status, 'failed'); assert.equal(fenced.tasks[0].nextAttemptAt, null);
    assert.equal(fenced.executions.length, 1); assert.equal(fenced.executions[0].status, 'timeout');
    assert.equal(fenced.executions[0].finalResponse, null, 'Late success persisted as an answer');
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_NATURAL_WATCHDOG_FALLBACK_NO_RETRY_LATE_FINISH_FENCED_OK',
        daemonStarted: false, simulateClock: false, elapsedMs: Date.now() - startedAt.getTime(),
        graceMs: ORCHESTRATOR_WATCHDOG_REPORT_GRACE_MS, lateFinishHttpStatus: late.status }));
} finally {
    await app.close();
    if (account) {
        await db.orchestratorRun.deleteMany({ where: { accountId: account } });
        await db.account.deleteMany({ where: { id: account, publicKey: tag } });
    }
    assert.equal(await db.account.count({ where: { publicKey: tag } }), 0);
    await db.$disconnect(); redis.disconnect();
}
