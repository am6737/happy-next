import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiAutopilotRoutes } from '../packages/happy-server/sources/app/api/routes/aiAutopilotRoutes';

// Real PostgreSQL + loopback HTTP webhook boundary. Projects are fixture data;
// no scheduler, provider, GitHub API, or Project authorization flow is used.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const app = require('fastify')({ logger: false });
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

const tag = randomUUID();
const owned: Array<{ accountId: string; projectId: string; agentId: string;
    conversationId: string; ruleId: string; secret: Buffer }> = [];
let base = '';

async function makeRule(suffix: string) {
    const account = await db.account.create({ data: { publicKey: `autopilot-webhook-${tag}-${suffix}` } });
    const item = { accountId: account.id, projectId: '', agentId: '', conversationId: '',
        ruleId: '', secret: randomBytes(32) };
    owned.push(item);
    const project = await db.aiProject.create({ data: { accountId: account.id,
        name: `Owned ${suffix}`, clientRequestId: `${tag}-${suffix}`,
        versions: { create: { version: 1, repositoryId: BigInt(1),
            repositoryFullName: 'fixture/fixture', machineId: `fixture-${tag}`,
            registeredRepoId: tag, registeredKvVersion: 0, workingDirectory: '/owned-fixture',
            defaultBranch: 'main', baseCommit: 'a'.repeat(40), snapshotHash: 'b'.repeat(64) } },
    } });
    item.projectId = project.id;
    const agent = await db.aiAgent.create({ data: { accountId: account.id,
        name: `Owned ${suffix}`, role: 'Fixture', description: '', emoji: '', instructions: '',
        settings: { engine: 'codex', model: 'default', instructions: '',
            workingDirectory: '/owned-fixture', permissionMode: 'guarded_auto', allowDelegation: false },
    } });
    item.agentId = agent.id;
    const conversation = await db.aiConversation.create({ data: { accountId: account.id,
        agentId: agent.id, scopeKey: `autopilot-webhook:${tag}:${suffix}`,
        kind: 'direct', title: `Owned ${suffix}` } });
    item.conversationId = conversation.id;
    const rule = await db.aiAutopilot.create({ data: { accountId: account.id,
        projectId: project.id, agentId: agent.id, conversationId: conversation.id,
        name: `Owned ${suffix}`, prompt: 'Fixture only', triggerKind: 'webhook',
        webhookSecret: item.secret, action: 'run_only', concurrencyPolicy: 'skip', enabled: true,
    } });
    item.ruleId = rule.id;
    return item;
}

function signedBody(secret: Buffer, deliveryId: string, raw: Buffer, timestamp = Date.now()) {
    const signature = createHmac('sha256', secret)
        .update(`${timestamp}.${deliveryId}.`).update(raw).digest('hex');
    return { deliveryId, timestamp, payloadBase64: raw.toString('base64'), signature };
}

async function post(ruleId: string, body: ReturnType<typeof signedBody>) {
    const response = await fetch(`${base}/v1/ai-team/autopilots/${ruleId}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() as { id?: string; status?: string } };
}

async function count(ruleId: string) {
    return db.aiAutopilotRun.count({ where: { autopilotId: ruleId } });
}

try {
    const [a, b] = await Promise.all([makeRule('a'), makeRule('b')]);
    aiAutopilotRoutes(app);
    base = await app.listen({ host: '127.0.0.1', port: 0 });
    const payload = Buffer.from('{"kind":"owned","value":1}', 'utf8');
    const deliveryId = `delivery:${tag}`;

    const invalid = await post(a.ruleId, { ...signedBody(a.secret, `bad:${tag}`, payload),
        signature: '0'.repeat(64) });
    assert.equal(invalid.status, 401);
    assert.equal(await count(a.ruleId), 0);

    const accepted = await Promise.all(Array.from({ length: 8 }, () =>
        post(a.ruleId, signedBody(a.secret, deliveryId, payload))));
    assert.ok(accepted.every((result) => result.status === 202));
    assert.equal(new Set(accepted.map((result) => result.body.id)).size, 1);
    assert.equal(await count(a.ruleId), 1);

    const invalidReplay = await post(a.ruleId, { ...signedBody(a.secret, deliveryId, payload),
        signature: '0'.repeat(64) });
    assert.equal(invalidReplay.status, 401);
    assert.equal(await count(a.ruleId), 1);

    const expired = await post(a.ruleId, signedBody(a.secret, `expired:${tag}`, payload,
        Date.now() - 10 * 60_000));
    assert.equal(expired.status, 401);
    assert.equal(await count(a.ruleId), 1);

    const wrongRule = await post(b.ruleId, signedBody(a.secret, `cross:${tag}`, payload));
    assert.equal(wrongRule.status, 401);
    assert.equal(await count(b.ruleId), 0);

    await db.aiAutopilot.update({ where: { id: a.ruleId }, data: { enabled: false } });
    const disabled = await post(a.ruleId, signedBody(a.secret, `disabled:${tag}`, payload));
    assert.equal(disabled.status, 401);
    assert.equal(await count(a.ruleId), 1);
    await db.aiAutopilot.update({ where: { id: a.ruleId }, data: { enabled: true } });
    console.log('REAL_DB_HTTP_AUTOPILOT_WEBHOOK_SIGNATURE_CONCURRENCY_REPLAY_EXPIRY_ISOLATION_DISABLE_OK');

    const changedPayload = await post(a.ruleId, signedBody(a.secret, deliveryId,
        Buffer.from('{"kind":"owned","value":2}', 'utf8')));
    const afterConflict = await count(a.ruleId);
    console.log(`REAL_DB_HTTP_AUTOPILOT_WEBHOOK_CONTENT_CONFLICT status=${changedPayload.status} runs=${afterConflict}`);
    assert.equal(afterConflict, 1);
    assert.equal(changedPayload.status, 409,
        'A delivery ID reused with different signed payload must be rejected');
} finally {
    await app.close();
    for (const item of owned) {
        await db.aiAutopilot.deleteMany({ where: { accountId: item.accountId } });
        await db.aiConversation.deleteMany({ where: { accountId: item.accountId } });
        await db.aiProject.deleteMany({ where: { accountId: item.accountId } });
        await db.aiAgent.deleteMany({ where: { accountId: item.accountId } });
        await db.account.deleteMany({ where: { id: item.accountId,
            publicKey: { startsWith: `autopilot-webhook-${tag}-` } } });
    }
    const [accounts, rules, runs, projects, agents, conversations] = await Promise.all([
        db.account.count({ where: { id: { in: owned.map((item) => item.accountId) } } }),
        db.aiAutopilot.count({ where: { id: { in: owned.map((item) => item.ruleId).filter(Boolean) } } }),
        db.aiAutopilotRun.count({ where: { autopilotId: { in: owned.map((item) => item.ruleId).filter(Boolean) } } }),
        db.aiProject.count({ where: { id: { in: owned.map((item) => item.projectId).filter(Boolean) } } }),
        db.aiAgent.count({ where: { id: { in: owned.map((item) => item.agentId).filter(Boolean) } } }),
        db.aiConversation.count({ where: { id: { in: owned.map((item) => item.conversationId).filter(Boolean) } } }),
    ]);
    console.log(`FIXTURE_RESIDUAL accounts=${accounts} rules=${rules} runs=${runs} projects=${projects} agents=${agents} conversations=${conversations}`);
    assert.deepEqual([accounts, rules, runs, projects, agents, conversations], [0, 0, 0, 0, 0, 0]);
    await db.$disconnect();
    redis.disconnect();
}
