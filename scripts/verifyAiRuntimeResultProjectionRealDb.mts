import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { AiRuntimeResultProjectionSchema } from 'happy-wire';

// Independently checks the public result projection, including preservation
// of a valid answer. Persisted execution/authentication are owned fixtures;
// this is not a provider, feature-handshake or delivery-verification test.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
const tag = randomUUID();
const accounts: string[] = [];
const safeAnswer = `FINAL_AGENT_ANSWER_${tag}`;
const rawDiagnostic = `RAW_RUNTIME_DIAGNOSTIC_${tag}`;
let base = '';
app.decorate('authenticate', async (request: any, reply: any) => {
    const accountId = request.headers['x-fixture-account'];
    if (!accounts.includes(accountId)) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = accountId;
});

async function fixture(current: boolean) {
    const run = await db.orchestratorRun.create({ data: {
        accountId: accounts[0], title: tag, status: 'completed',
        ...(current ? { metadata: { coordinatorChat: true, aiRuntimeContract: {
            kind: 'coordinator', structuredFinalResponseVersion: 1, deliveryProofVersion: 0,
        } } } : {}),
        tasks: { create: { seq: 1, taskKey: 'answer', provider: 'codex', prompt: 'Owned fixture',
            status: 'completed', outputText: rawDiagnostic, outputSummary: rawDiagnostic,
            ...(current ? { finalResponse: safeAnswer } : {}),
        } },
    }, include: { tasks: true } });
    await db.orchestratorExecution.create({ data: {
        runId: run.id, taskId: run.tasks[0].id, machineId: randomUUID(), provider: 'codex',
        status: 'completed', dispatchToken: randomUUID(),
        capabilityProtocolVersion: current ? 1 : 0,
        outputText: rawDiagnostic, outputSummary: rawDiagnostic,
        ...(current ? { finalResponse: safeAnswer } : {}),
    } });
    return run;
}

async function get(path: string, actor = accounts[0]) {
    const response = await fetch(`${base}${path}`, {
        headers: { 'x-fixture-account': actor }, signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, body: await response.json() as any };
}

try {
    for (let index = 0; index < 2; index++) accounts.push((await db.account.create({
        data: { publicKey: `runtime-result-root-${tag}-${index}` },
    })).id);
    orchestratorRoutes(app);
    base = await app.listen({ host: '127.0.0.1', port: 0 });
    for (const current of [false, true]) {
        const run = await fixture(current);
        const taskPath = `/v1/orchestrator/runs/${run.id}/tasks/${run.tasks[0].id}?includeExecutions=true`;
        const result = await get(taskPath);
        assert.equal(result.status, 200);
        const task = result.body.data.task;
        AiRuntimeResultProjectionSchema.parse(task);
        AiRuntimeResultProjectionSchema.parse(task.executions[0]);
        assert.equal(task.status, 'completed', 'Process completion was rewritten');
        assert.equal(JSON.stringify(result.body).includes(rawDiagnostic), false, 'Raw runtime diagnostics exposed');
        assert.equal(task.deliveryVerified === true, false, 'Answer fixture was reported as verified delivery');
        if (current) {
            assert.equal(task.finalResponse ?? task.outputText, safeAnswer, 'Valid final agent answer disappeared');
            assert.equal(task.answerVerified, true, 'Trusted structured answer lost its verification state');
            assert.equal(task.executions[0].finalResponse ?? task.executions[0].outputText,
                safeAnswer, 'Execution projection lost the valid final answer');
        } else {
            assert.equal(task.answerVerified === true, false, 'Legacy process completion became trusted answer');
            assert.equal(task.finalResponse ?? task.outputText, null);
        }
        assert.equal((await get(taskPath, accounts[1])).status, 404);
        const wholeRun = await get(`/v1/orchestrator/runs/${run.id}?includeTasks=true`);
        assert.equal(wholeRun.status, 200);
        AiRuntimeResultProjectionSchema.parse(wholeRun.body.data.tasks[0]);
        assert.equal(JSON.stringify(wholeRun.body).includes(rawDiagnostic), false);
        if (current) assert.equal(wholeRun.body.data.tasks[0].finalResponse
            ?? wholeRun.body.data.tasks[0].outputText, safeAnswer, 'Run projection lost the valid answer');
        const pending = await get(`/v1/orchestrator/runs/${run.id}/pend?include=all_tasks&timeoutMs=0`);
        assert.equal(pending.status, 200);
        AiRuntimeResultProjectionSchema.parse(pending.body.data.tasks[0]);
        assert.equal(JSON.stringify(pending.body).includes(rawDiagnostic), false);
        if (current) assert.equal(pending.body.data.tasks[0].finalResponse
            ?? pending.body.data.tasks[0].outputText, safeAnswer, 'Pend projection lost the valid answer');
    }
    console.log('REAL_HTTP_DB_RUNTIME_RESULT_PRESERVES_TRUSTED_ANSWER_HIDES_RAW_DIAGNOSTICS_AND_ACCOUNT_ISOLATION_OK');
} finally {
    await app.close();
    await db.orchestratorRun.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts },
        publicKey: { startsWith: `runtime-result-root-${tag}-` } } });
    assert.equal(await db.account.count({ where: { id: { in: accounts } } }), 0);
    await db.$disconnect();
    redis.disconnect();
    console.log('RUNTIME_RESULT_ROOT_FIXTURE_CLEANUP residual=0');
}
