import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { orchestratorSchedulerTick, ORCHESTRATOR_CANCEL_GRACE_MS } from '../packages/happy-server/sources/app/orchestrator/scheduler';

// Actual DB, cancel/finish HTTP and scheduler, with no machine connection.
// Default mode waits for actual cancellation grace. --simulate-clock retains
// the earlier injected scheduler-time fixture; neither starts a real daemon.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
const tag = `offline-cancel-${randomUUID()}`; let account: string | undefined;
const simulateClock = process.argv.includes('--simulate-clock');
app.decorate('authenticate', async (request: any, reply: any) => {
    if (request.headers['x-fixture-account'] !== account) return reply.code(401).send({ error: 'fixture' });
    request.userId = account;
});
try {
    account = (await db.account.create({ data: { publicKey: tag } })).id;
    const token = randomUUID();
    const run = await db.orchestratorRun.create({ data: { accountId: account, title: tag, status: 'running',
        tasks: { create: { seq: 1, taskKey: 'offline', provider: 'codex', prompt: '', status: 'running',
            retryMaxAttempts: 3, targetMachineId: tag } },
    }, include: { tasks: true } });
    const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
        taskId: run.tasks[0].id, machineId: tag, provider: 'codex', status: 'running',
        dispatchToken: token, startedAt: new Date(), timeoutMs: 24 * 60 * 60 * 1000 } });
    orchestratorRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: object) => fetch(`${base}${path}`, { method: 'POST',
        signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'x-fixture-account': account! },
        body: JSON.stringify(body) });
    assert.equal((await post(`/v1/orchestrator/runs/${run.id}/cancel`, { reason: 'Owned offline recovery fixture' })).status, 200);
    const requested = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.ok(requested.cancelRequestedAt);
    if (!simulateClock) {
        assert.ok(ORCHESTRATOR_CANCEL_GRACE_MS > 0 && ORCHESTRATOR_CANCEL_GRACE_MS <= 300000);
        await orchestratorSchedulerTick(new Date(), account);
        assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'canceling',
            'Offline cancellation skipped its confirmation grace');
        await new Promise(resolve => setTimeout(resolve, Math.max(0,
            requested.cancelRequestedAt!.getTime() + ORCHESTRATOR_CANCEL_GRACE_MS + 500 - Date.now())));
    }
    const simulatedNow = new Date(requested.cancelRequestedAt.getTime() + 5 * 60 * 1000);
    await orchestratorSchedulerTick(simulateClock ? simulatedNow : new Date(), account);
    const after = await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id },
        include: { tasks: true, executions: true } });
    console.log(JSON.stringify({ result: 'REAL_DB_HTTP_OFFLINE_CANCEL_RECOVERY',
        simulateClock, graceMs: ORCHESTRATOR_CANCEL_GRACE_MS,
        elapsedMs: Date.now() - requested.cancelRequestedAt.getTime(), runStatus: after.status,
        taskStatus: after.tasks[0].status, executionStatus: after.executions[0].status }));
    assert.equal(after.status, 'cancelled', 'Offline cancellation still waits for the 24-hour execution timeout');
    assert.equal(after.tasks[0].status, 'cancelled');
    assert.equal(after.executions[0].status, 'cancelled');
    assert.equal(await db.orchestratorExecution.count({ where: { taskId: run.tasks[0].id } }), 1);
    await post(`/v1/orchestrator/executions/${execution.id}/finish`, {
        dispatchToken: token, status: 'completed', exitCode: 0, finalResponse: 'Late offline result' });
    assert.equal((await db.orchestratorRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'cancelled');
    assert.equal((await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } })).status, 'cancelled');
    console.log('REAL_DB_HTTP_OFFLINE_CANCEL_TERMINAL_NO_RETRY_LATE_FINISH_FENCED_OK');
} finally {
    await app.close();
    if (account) {
        await db.orchestratorRun.deleteMany({ where: { accountId: account } });
        await db.account.deleteMany({ where: { id: account, publicKey: tag } });
    }
    assert.equal(await db.account.count({ where: { publicKey: tag } }), 0);
    await db.$disconnect(); redis.disconnect();
}
