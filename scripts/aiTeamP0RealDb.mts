import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { claimInbound } from '../packages/happy-server/sources/app/api/routes/aiInboundRequest';
import { connectRoutes } from '../packages/happy-server/sources/app/api/routes/connectRoutes';
import { initGithub } from '../packages/happy-server/sources/modules/github';
import { redis } from '../packages/happy-server/sources/storage/redis';

// Run from happy-server with its tsconfig and .env.dev. This uses the real
// PostgreSQL and a loopback HTTP listener, with synthetic signed payloads.
// It never sends to GitHub and deletes only IDs created by this process.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const tag = randomUUID();
const repository = `ai-team-fixture/${tag}`;
const repositoryId = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
const accounts: string[] = [];
const runs: string[] = [];
const deliveries: string[] = [];
const existingPr = process.argv.includes('--already-associated-pr');
const app = fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
app.decorate('authenticate', async () => { throw new Error('This fixture only exercises unauthenticated signed webhook routes'); });
const secret = randomUUID();
process.env.GITHUB_WEBHOOK_SECRET = secret;

async function fixture() {
    const account = await db.account.create({ data: { publicKey: `ai-team-p0-${randomUUID()}` } });
    accounts.push(account.id);
    const settings = { instructions: '', engine: 'codex', model: 'default', workingDirectory: '', permissionMode: 'read_only', allowDelegation: false };
    const agent = await db.aiAgent.create({ data: { accountId: account.id, name: tag, role: 'Fixture', description: 'Local acceptance fixture', emoji: '', instructions: '', settings } });
    const conversation = await db.aiConversation.create({ data: { accountId: account.id, agentId: agent.id, scopeKey: tag, kind: 'direct', title: 'Fixture' } });
    const run = await db.orchestratorRun.create({ data: { accountId: account.id, title: 'Fixture', status: 'completed', tasks: { create: { seq: 1, taskKey: 'fixture', provider: 'codex', prompt: '', status: 'completed', branchName: `happy-agent/${tag}`, commitSha: 'a'.repeat(40) } } }, include: { tasks: true } });
    runs.push(run.id);
    const work = await db.aiWorkItem.create({ data: { accountId: account.id, assigneeId: agent.id, conversationId: conversation.id, orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id, title: 'Fixture', summary: '', sourceType: 'github', sourceLabel: 'Fixture', sourceResourceId: `${repository}#1`, ...(existingPr ? { pullRequestNumber: 7, pullRequestState: 'open', pullRequestUrl: `https://github.com/${repository}/pull/7` } : {}) } });
    return { account, conversation, run, work };
}

try {
    const authorized = await fixture();
    const other = await fixture();
    await db.aiGithubRepositoryGrant.create({ data: { accountId: authorized.account.id, repositoryId: BigInt(repositoryId), fullName: repository } });
    const key = { accountId: authorized.account.id, conversationId: authorized.conversation.id, clientMessageId: tag };
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimInbound(key, { text: 'same request' })));
    assert.equal(claims.filter((result) => result.kind === 'claimed').length, 1, 'Concurrent DB claim duplicated');
    assert.equal(await db.aiInboundRequest.count({ where: key }), 1);
    assert.equal((await claimInbound(key, { text: 'different request' })).kind, 'conflict');
    const initial = await db.aiInboundRequest.findUniqueOrThrow({ where: { accountId_conversationId_clientMessageId: key } });
    await db.aiInboundRequest.update({ where: { accountId_conversationId_clientMessageId: key }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
    const recovered = await claimInbound(key, { text: 'same request' });
    assert.equal(recovered.kind, 'claimed', 'Expired lease did not recover');
    const stale = await db.aiInboundRequest.updateMany({ where: { ...key, claimOwner: initial.claimOwner }, data: { status: 'failed' } });
    assert.equal(stale.count, 0, 'Old owner can mutate a stolen lease');
    console.log('REAL_DB_INBOUND_CONCURRENCY_AND_LEASE_OK');

    await initGithub();
    connectRoutes(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const payload = { action: 'opened', repository: { id: repositoryId, full_name: repository }, pull_request: { number: 7, html_url: `https://github.com/${repository}/pull/7`, title: 'Fixture', body: 'Closes #1', state: 'open', merged: false, updated_at: '2026-10-07T00:00:00Z', head: { ref: `happy-agent/${tag}`, sha: 'a'.repeat(40) } } };
    const send = async (delivery: string, value: unknown, valid = true) => {
        if (!deliveries.includes(delivery)) deliveries.push(delivery);
        const body = JSON.stringify(value);
        return fetch(`${base}/v1/connect/github/webhook`, { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-github-delivery': delivery, 'x-hub-signature-256': `sha256=${createHmac('sha256', valid ? secret : 'invalid').update(body).digest('hex')}` }, body });
    };
    const firstId = `${tag}-opened`;
    assert.equal((await send(firstId, payload)).status, 200);
    const firstWork = await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } });
    assert.equal(firstWork.pullRequestNumber, 7, 'First webhook did not bind an initially-null PR');
    assert.equal(firstWork.pullRequestState, 'open');
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: other.work.id } })).pullRequestEventAt, null, 'Webhook crossed an account boundary');
    assert.equal((await send(firstId, payload, false)).status, 401, 'Duplicate delivery bypassed signature verification');
    assert.equal((await send(firstId, payload)).status, 200);
    assert.equal((await send(firstId, { ...payload, action: 'reopened' })).status, 409, 'Delivery hash conflict accepted');
    const closed = { ...payload, action: 'closed', pull_request: { ...payload.pull_request, state: 'closed', updated_at: '2026-10-07T00:02:00Z' } };
    const concurrency = await Promise.all(Array.from({ length: 8 }, () => send(`${tag}-closed`, closed)));
    assert.ok(concurrency.every((response) => response.status === 200 || response.status === 503));
    assert.equal((await send(`${tag}-closed`, closed)).status, 200);
    const afterClose = await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } });
    assert.equal(afterClose.pullRequestState, 'closed');
    assert.equal(afterClose.acceptanceStatus, 'pending', 'Closing an unmerged PR approved delivery');
    assert.equal((await send(`${tag}-old-open`, payload)).status, 200);
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } })).pullRequestState, 'closed', 'Old event regressed PR state');
    const reopened = { ...payload, action: 'reopened', pull_request: { ...payload.pull_request, updated_at: '2026-10-07T00:03:00Z' } };
    const crashId = `${tag}-expired-reservation`;
    deliveries.push(crashId);
    await db.githubWebhookDelivery.create({ data: { id: crashId, event: 'pull_request', payloadHash: createHash('sha256').update(JSON.stringify(reopened)).digest('hex'), status: 'processing', claimOwner: 'crashed-fixture-owner', leaseUntil: new Date(Date.now() - 1_000) } });
    assert.equal((await send(crashId, reopened)).status, 200, 'Expired delivery reservation did not recover');
    const recoveredDelivery = await db.githubWebhookDelivery.findUniqueOrThrow({ where: { id: crashId } });
    assert.equal(recoveredDelivery.status, 'succeeded');
    assert.equal(recoveredDelivery.attempts, 2);
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } })).pullRequestState, 'open');
    const wrongInstall = { ...closed, installation: { id: 77 }, pull_request: { ...closed.pull_request, updated_at: '2026-10-07T00:04:00Z' } };
    assert.equal((await send(`${tag}-wrong-install`, wrongInstall)).status, 200);
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } })).pullRequestState, 'open', 'Installation boundary failed');
    const otherPr = { ...closed, pull_request: { ...closed.pull_request, number: 8, html_url: `https://github.com/${repository}/pull/8`, updated_at: '2026-10-07T00:04:00Z' } };
    assert.equal((await send(`${tag}-different-pr`, otherPr)).status, 200);
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } })).pullRequestNumber, 7, 'Parallel PR stole an existing association');
    // Synthetic signed local payload only: this does not merge an external PR.
    const merged = { ...closed, pull_request: { ...closed.pull_request, merged: true, merged_at: '2026-10-07T00:05:00Z', updated_at: '2026-10-07T00:05:00Z' } };
    assert.equal((await send(`${tag}-synthetic-merged`, merged)).status, 200);
    const afterMerge = await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } });
    assert.equal(afterMerge.pullRequestState, 'merged');
    assert.equal(afterMerge.acceptanceStatus, 'pending', 'Merge event bypassed human acceptance');
    assert.equal(afterMerge.requiresDecision, true, 'Unaccepted merged delivery did not request a human decision');
    assert.equal((await send(`${tag}-later-open`, { ...reopened, pull_request: { ...reopened.pull_request, updated_at: '2026-10-07T00:06:00Z' } })).status, 200);
    assert.equal((await db.aiWorkItem.findUniqueOrThrow({ where: { id: authorized.work.id } })).pullRequestState, 'merged', 'Merged state regressed');
    console.log(existingPr ? 'REAL_HTTP_EXISTING_PR_ISOLATION_CONCURRENCY_AND_ORDER_OK' : 'REAL_HTTP_NEW_PR_ISOLATION_CONCURRENCY_AND_ORDER_OK');
} finally {
    await app.close();
    await db.githubWebhookDelivery.deleteMany({ where: { id: { in: deliveries } } });
    await db.aiInboundRequest.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiGithubRepositoryGrant.deleteMany({ where: { accountId: { in: accounts } } });
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: { in: accounts } } });
    await db.aiConversation.deleteMany({ where: { accountId: { in: accounts } } });
    await db.aiAgent.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: 'ai-team-p0-' } } });
    await db.$disconnect();
    redis.disconnect();
}
