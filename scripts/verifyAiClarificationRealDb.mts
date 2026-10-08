import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { aiTeamRoutes } from '../packages/happy-server/sources/app/api/routes/aiTeamRoutes';

// Real DB + authenticated loopback HTTP. No model/daemon or external GitHub.
// Recreating the HTTP app proves pending clarification is durable, not memory.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const tag = randomUUID();
const accounts: string[] = [];
let app: any;
async function listener() {
    app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: any, reply: any) => {
        const accountId = request.headers['x-fixture-account'];
        if (!accounts.includes(accountId)) return reply.code(401).send({ error: 'Fixture authentication required' });
        request.userId = accountId;
    });
    aiTeamRoutes(app);
    return await app.listen({ host: '127.0.0.1', port: 0 });
}
try {
    for (let i = 0; i < 2; i++) {
        const account = await db.account.create({ data: { publicKey: `ai-team-clarification-${tag}-${i}` } });
        accounts.push(account.id);
    }
    const agent = await db.aiAgent.create({ data: { accountId: accounts[0], name: 'Clarification fixture', role: 'Coordinator',
        description: 'Loopback acceptance', emoji: '', instructions: '',
        settings: { instructions: '', engine: 'codex', model: 'default', workingDirectory: '', permissionMode: 'read_only', allowDelegation: false } } });
    const conversation = await db.aiConversation.create({ data: { accountId: accounts[0], agentId: agent.id,
        scopeKey: tag, kind: 'direct', title: 'Clarification fixture' } });
    let base = await listener();
    const send = async (accountId: string, body: unknown) => fetch(`${base}/v1/ai-team/conversations/${conversation.id}/messages`, {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-fixture-account': accountId }, body: JSON.stringify(body),
    });
    const body = { text: 'Please help me', clientMessageId: tag };
    const replies = await Promise.all(Array.from({ length: 8 }, () => send(accounts[0], body)));
    assert.ok(replies.every((response) => response.status === 200 || response.status === 503), 'Unexpected concurrency response');
    const confirmed = await send(accounts[0], body);
    assert.equal(confirmed.status, 200);
    const result: any = await confirmed.json();
    assert.equal(result.kind, 'clarify');
    assert.ok(result.clarificationId, 'Clarification identity was not returned');
    assert.equal(await db.aiClarification.count({ where: { accountId: accounts[0], conversationId: conversation.id } }), 1);
    assert.equal(await db.aiWorkItem.count({ where: { accountId: accounts[0] } }), 0, 'Ambiguity created work');
    const persisted = await db.aiClarification.findUniqueOrThrow({ where: { id: result.clarificationId } });
    assert.equal(persisted.status, 'pending');
    assert.equal(persisted.originalText, body.text);
    const conflict = await send(accounts[0], { ...body, text: 'Changed requirements' });
    assert.equal(conflict.status, 409, 'Message identity accepted changed content');
    await app.close();
    base = await listener();
    const afterRestart = await send(accounts[0], body);
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(await afterRestart.json(), result, 'Recreated server did not recover durable response');
    assert.equal((await send(accounts[1], body)).status, 404, 'Other account accessed the conversation');
    const invalidAnswer = await send(accounts[0], { text: 'Fix README', clientMessageId: `${tag}-answer`, clarificationId: randomUUID() });
    assert.equal(invalidAnswer.status, 409, 'Unknown clarification was accepted');
    assert.equal((await db.aiClarification.findUniqueOrThrow({ where: { id: result.clarificationId } })).status, 'pending');
    assert.equal(await db.aiWorkItem.count({ where: { accountId: accounts[0] } }), 0);
    console.log('REAL_DB_HTTP_CLARIFICATION_DURABILITY_CONCURRENCY_AND_ACCOUNT_ISOLATION_OK');
} finally {
    await app?.close();
    // Clean only this invocation's owned IDs and expected public-key prefix.
    await db.aiInboundRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: `ai-team-clarification-${tag}-` } } });
    await db.$disconnect(); redis.disconnect();
}
