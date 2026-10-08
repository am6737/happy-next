import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { ApiClient } from '../packages/happy-cli/src/api/api';
import { saveExecutionCapability } from '../packages/happy-cli/src/orchestrator/executionCapability';
import { startTemplateProposalProxy } from '../packages/happy-cli/src/orchestrator/templateProposalProxy';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(new URL(process.env.HAPPY_SERVER_URL!).hostname, '127.0.0.1');
const api = await ApiClient.create({ token: input.accountId,
    encryption: { type: 'legacy', secret: new Uint8Array(32) } });
await saveExecutionCapability(input.capabilityRoot, input.executionId, input.dispatchToken, input.capability);
api.setExecutionCapabilityRoot(input.capabilityRoot);
const context = await api.getExecutionTemplateProposalContext(input);
assert.equal(context.templateId, input.templateId);
assert.equal(context.frozenVersion, 2);
assert.equal(context.currentVersion, 1);
assert.deepEqual(context.frozenContent, input.frozenContent);
console.log('REAL_CLI_API_TEMPLATE_CONTEXT_FROZEN2_ROLLBACK_CURRENT1_OK');
const proxy = await startTemplateProposalProxy({ api, machineId: input.machineId,
    privateRoot: input.proxyRoot, payload: { provider: 'codex', executionId: input.executionId,
        dispatchToken: input.dispatchToken, executionCapability: input.capability } as any });
try {
    assert.equal(statSync(proxy.socketPath).mode & 0o777, 0o600);
    assert.deepEqual(proxy.frozenContent, input.frozenContent);
    const send = (body: unknown): Promise<{ status: number; value: any }> => new Promise((resolve, reject) => {
        const req = request({ socketPath: proxy.socketPath, path: '/propose', method: 'POST',
            headers: { 'content-type': 'application/json' }, timeout: 15000 }, response => {
            let data = ''; response.setEncoding('utf8');
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => resolve({ status: response.statusCode!, value: JSON.parse(data) }));
        });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Owned proxy timeout')));
        req.end(JSON.stringify(body));
    });
    const body = { clientRequestId: 'root-cli-proxy-rollback', content: {
        ...input.frozenContent, instructions: 'Owned Unix socket proposed change; pending human review' },
        note: 'Owned root client bridge acceptance' };
    const replies = await Promise.all(Array.from({ length: 4 }, () => send(body)));
    console.log(`REAL_CLI_TEMPLATE_PROXY_STATUSES ${replies.map(reply => reply.status).join(',')}`);
    assert.ok(replies.every(reply => reply.status === 200 && reply.value.status === 'pending'));
    assert.equal(new Set(replies.map(reply => reply.value.id)).size, 1);
    assert.equal(replies.filter(reply => !reply.value.duplicate).length, 1);
    assert.ok(![input.accountId, input.capability.token, input.dispatchToken].some(secret =>
        JSON.stringify(replies).includes(secret)), 'Proxy response disclosed authentication');
    for (const extra of [{ templateId: input.templateId }, { sourceAgentId: 'forged' },
        { expectedCurrentVersion: 2 }, { confirmed: true }, { capability: input.capability.token }]) {
        assert.equal((await send({ ...body, ...extra })).status, 409);
    }
    assert.equal((await send({ ...body, note: 'changed same key' })).status, 409);
    assert.equal((await send({ ...body, content: { ...body.content, permissionMode: 'guarded_auto' } })).status, 409);
    console.log('REAL_CLI_UNIX_PROXY_HTTP_TEMPLATE_PENDING_CONCURRENCY_NO_IDENTITY_OVERRIDE_OR_SECRET_OK');
} finally { await proxy.close(); }
assert.equal(existsSync(proxy.socketPath), false);
