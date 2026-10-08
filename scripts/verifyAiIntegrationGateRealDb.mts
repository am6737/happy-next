import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { orchestratorRoutes } from '../packages/happy-server/sources/app/api/routes/orchestratorRoutes';
import { integrationVerificationTick } from '../packages/happy-server/sources/app/ai/integrationVerification';
import { getOrCreateUserRpcListeners } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';

// A structurally consistent report is deliberately backed by no actual Git
// repository or verification RPC. A server must not mark a team run completed
// solely because its own stored (runtime-supplied) SHAs match that report.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const fastify = require('fastify');
const { validatorCompiler, serializerCompiler } = require('fastify-type-provider-zod');
const tag = randomUUID(); let accountId = ''; let runId = '';
const leaseExpired = process.argv.includes('--lease-expired');
const commitReadLeaseExpired = process.argv.includes('--commit-read-lease-expired');
assert.ok(!(leaseExpired && commitReadLeaseExpired), 'Select one lease timing mode');
let restoreExecutionRead: (() => void) | undefined;
let restoreTransaction: (() => void) | undefined;
const app = fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
app.decorate('authenticate', async (request: any, reply: any) => {
    if (!accountId || request.headers['x-fixture-account'] !== accountId) return reply.code(401).send({ error: 'Fixture authentication required' });
    request.userId = accountId;
});
try {
    accountId = (await db.account.create({ data: { publicKey: `ai-team-integration-gate-${tag}` } })).id;
    const baseCommit = 'b'.repeat(40); const aggregateCommit = 'f'.repeat(40);
    const settings = { instructions: '', engine: 'codex', model: 'default', workingDirectory: '', permissionMode: 'guarded_auto', allowDelegation: true };
    const agent = await db.aiAgent.create({ data: { accountId, name: tag, role: 'Fixture', description: '', emoji: '', instructions: '', settings } });
    const team = await db.aiTeam.create({ data: { accountId, name: tag, description: '', emoji: '', instructions: '', leaderId: agent.id, members: { create: { agentId: agent.id } } } });
    const conversation = await db.aiConversation.create({ data: { accountId, agentId: agent.id, teamId: team.id, scopeKey: tag, kind: 'group', title: tag } });
    const run = await db.orchestratorRun.create({ data: { accountId, title: tag, status: 'running', metadata: { aiTeamId: team.id }, tasks: { create: [
        { seq: 1, taskKey: 'primary', provider: 'codex', prompt: '', status: 'completed', collaborationRole: 'leader_plan', assignedAgentId: agent.id },
        { seq: 2, taskKey: 'alpha', provider: 'codex', prompt: '', status: 'completed', collaborationRole: 'delegated', assignedAgentId: agent.id, branchName: 'happy-agent/alpha', baseCommit, commitSha: 'c'.repeat(40) },
        { seq: 3, taskKey: 'beta', provider: 'codex', prompt: '', status: 'completed', collaborationRole: 'delegated', assignedAgentId: agent.id, branchName: 'happy-agent/beta', baseCommit, commitSha: 'd'.repeat(40) },
        { seq: 4, taskKey: 'aggregate', provider: 'codex', prompt: '', status: 'running', collaborationRole: 'aggregate', assignedAgentId: agent.id, dependsOnTaskKeys: ['primary', 'alpha', 'beta'] },
    ] } }, include: { tasks: true } }); runId = run.id;
    const leader = run.tasks.find((task) => task.taskKey === 'primary')!;
    const aggregate = run.tasks.find((task) => task.taskKey === 'aggregate')!;
    const children = run.tasks.filter((task) => task.collaborationRole === 'delegated');
    await db.orchestratorTask.updateMany({ where: { id: { in: [...children.map((task) => task.id), aggregate.id] } }, data: { parentTaskId: leader.id } });
    await db.aiWorkItem.create({ data: { accountId, assigneeId: agent.id, teamId: team.id, conversationId: conversation.id,
        orchestratorRunId: run.id, orchestratorTaskId: aggregate.id, title: tag, summary: '', sourceType: 'execution', sourceLabel: 'Owned fixture', sourceResourceId: conversation.id } });
    const dispatchToken = randomUUID();
    const execution = await db.orchestratorExecution.create({ data: { runId, taskId: aggregate.id, machineId: tag, provider: 'codex', status: 'running', dispatchToken } });
    orchestratorRoutes(app); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const finishBody = { dispatchToken, status: 'completed', exitCode: 0, branchName: 'happy-agent/aggregate', baseCommit, commitSha: aggregateCommit,
        finalResponse: 'Unverified fixture claims completion', integrationProof: { baseCommit, aggregateCommit,
            members: children.map((task) => ({ taskId: task.id, branchName: task.branchName, sourceCommit: task.commitSha, integratedCommit: aggregateCommit })) } };
    const finish = (body = finishBody) => fetch(`${base}/v1/orchestrator/executions/${execution.id}/finish`, {
        method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'x-fixture-account': accountId },
        body: JSON.stringify(body),
    });
    const response = await finish();
    assert.equal(response.status, 200, 'Consistent report should be durably accepted for independent verification');
    const persisted = await db.orchestratorRun.findUniqueOrThrow({ where: { id: runId } });
    assert.notEqual(persisted.status, 'completed', 'Unverified runtime report completed the team without independent Git evidence');
    const verification = await db.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
    assert.equal(verification.status, 'pending');
    assert.equal(verification.accountId, accountId);
    assert.equal(verification.runId, runId);
    assert.deepEqual(verification.proof, finishBody.integrationProof);
    assert.equal((await db.orchestratorTask.findUniqueOrThrow({ where: { id: aggregate.id } })).status, 'running');
    assert.equal((await finish()).status, 200, 'Identical finish replay must remain idempotent');
    assert.equal(await db.aiIntegrationVerification.count({ where: { executionId: execution.id } }), 1);
    // Simulate restarted/multiple workers with no registered verification RPC.
    // A finish ACK must never be mistaken for a verified Git result.
    await Promise.all(Array.from({ length: 4 }, () => integrationVerificationTick(new Date(), accountId)));
    const after = await db.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
    assert.equal(after.status, 'pending');
    assert.equal(after.verifiedAt, null);
    assert.equal(after.attempts, 0, 'Offline machine must not exhaust verification attempts');
    assert.equal(after.expectedHash, verification.expectedHash);
    assert.notEqual((await db.orchestratorRun.findUniqueOrThrow({ where: { id: runId } })).status, 'completed');
    console.log('REAL_DB_HTTP_UNVERIFIED_INTEGRATION_CANNOT_COMPLETE_TEAM_OK durable=pending duplicate=one workers=4 noRpc=noCompletion');
    if (leaseExpired || commitReadLeaseExpired) {
        // Isolate worker fencing using an accepting fixture RPC, not actual Git.
        // A real execution query waits 20s before RPC; the ACK then waits for
        // the unchanged 45s claim to expire, within the RPC's 30s time budget.
        const original = db.orchestratorExecution.findFirst;
        (db.orchestratorExecution as any).findFirst = async (args: any) => {
            const actual = await original.call(db.orchestratorExecution, args);
            if (args?.where?.id === execution.id && args.select?.dispatchToken) {
                await new Promise(resolve => setTimeout(resolve, commitReadLeaseExpired ? 42000 : 20000));
            }
            return actual;
        };
        restoreExecutionRead = () => { (db.orchestratorExecution as any).findFirst = original; };
        if (commitReadLeaseExpired) {
            const transaction = db.$transaction;
            (db as any).$transaction = (action: any, options: any) => transaction.call(db, async (tx: any) => {
                const findExecution = tx.orchestratorExecution.findUnique;
                tx.orchestratorExecution.findUnique = async (args: any) => {
                    const actual = await findExecution.call(tx.orchestratorExecution, args);
                    if (args?.where?.id === execution.id && args.select?.dispatchToken) {
                        const claim = await db.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
                        const remaining = claim.leaseUntil!.getTime() - Date.now() + 150;
                        assert.ok(remaining > 0 && remaining < 4000, 'Commit barrier must stay below transaction timeout');
                        await new Promise(resolve => setTimeout(resolve, remaining));
                    }
                    return actual;
                };
                return action(tx);
            }, options);
            restoreTransaction = () => { (db as any).$transaction = transaction; };
        }
        let deliveries = 0;
        const rpc: any = { connected: true, timeout: () => rpc,
            emitWithAck: async (_event: string, payload: any) => {
                assert.equal(payload.params.executionId, execution.id);
                assert.equal(payload.params.expectedHash, verification.expectedHash);
                const claimed = await db.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
                assert.equal(claimed.status, 'processing'); assert.ok(claimed.claimOwner);
                const remaining = claimed.leaseUntil!.getTime() - Date.now() + 150;
                assert.ok(remaining > 0 && remaining < 30000, 'ACK delay must stay within actual RPC timeout');
                deliveries++;
                if (!commitReadLeaseExpired) await new Promise(resolve => setTimeout(resolve, remaining));
                return { verified: true, expectedHash: verification.expectedHash };
            } };
        getOrCreateUserRpcListeners(accountId).set(`${tag}:orchestrator-verify-integration`, rpc);
        await integrationVerificationTick(new Date(), accountId);
        restoreExecutionRead(); restoreTransaction?.();
        const expired = await db.aiIntegrationVerification.findUniqueOrThrow({ where: { executionId: execution.id } });
        const expiredRun = await db.orchestratorRun.findUniqueOrThrow({ where: { id: runId } });
        console.log(JSON.stringify({ result: commitReadLeaseExpired
            ? 'REAL_DB_INTEGRATION_LAST_COMMIT_READ_AFTER_NATURAL_LEASE_EXPIRY'
            : 'REAL_DB_INTEGRATION_ACK_AFTER_NATURAL_LEASE_EXPIRY',
            commitReadLeaseExpired, deliveries, verificationStatus: expired.status, runStatus: expiredRun.status }));
        assert.equal(deliveries, 1);
        assert.notEqual(expired.status, 'verified', commitReadLeaseExpired
            ? 'Last identity query crossed claim expiry but the transaction committed verification'
            : 'Expired claim accepted a late verification ACK');
        assert.notEqual(expiredRun.status, 'completed', 'Expired verification claim completed the aggregate run');
        console.log(commitReadLeaseExpired ? 'REAL_DB_INTEGRATION_LAST_COMMIT_READ_NATURAL_LEASE_EXPIRY_FENCED_OK'
            : 'REAL_DB_INTEGRATION_NATURAL_LEASE_EXPIRY_ACK_FENCED_OK');
    }
} finally {
    restoreExecutionRead?.(); restoreTransaction?.();
    await app.close();
    if (accountId) {
        getOrCreateUserRpcListeners(accountId).clear();
        await db.orchestratorRun.deleteMany({ where: { id: runId, accountId } });
        await db.aiConversation.deleteMany({ where: { accountId, scopeKey: tag } });
        await db.aiTeam.deleteMany({ where: { accountId, name: tag } });
        await db.aiAgent.deleteMany({ where: { accountId, name: tag } });
        await db.account.deleteMany({ where: { id: accountId, publicKey: `ai-team-integration-gate-${tag}` } });
        assert.equal(await db.account.count({ where: { id: accountId } }), 0);
    }
    await db.$disconnect(); redis.disconnect();
}
