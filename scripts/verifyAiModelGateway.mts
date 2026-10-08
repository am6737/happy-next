import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { requestStructuredModel } from '../packages/happy-server/sources/app/ai/modelGateway';

// Real loopback HTTP provider fixture, not a real LLM. Exercises Node fetch
// streaming and cancellation without sending credentials or prompts externally.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const { z } = require('zod');
const schema = z.object({ intent: z.enum(['chat', 'clarify', 'task']) });
const original = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };
const runId = randomUUID();
const fixtureAccount = (scope: string) => `fixture-${runId}-${scope}`;
let mode: 'valid' | 'oversized' | 'stall' = 'valid';
let requests = 0;
const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer loopback-fixture-only');
    requests++;
    for await (const _chunk of request) { /* Drain request body without logging it. */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    if (mode === 'stall') { response.write('{'); return; }
    if (mode === 'oversized') { response.end('x'.repeat(65_537)); return; }
    response.end(JSON.stringify({ choices: [{ message: { content: '{"intent":"chat"}' } }] }));
});
try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    process.env.OPENAI_API_KEY = 'loopback-fixture-only';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    assert.deepEqual(await requestStructuredModel({ accountId: fixtureAccount('valid'), prompt: 'Classify hello', schema }), { intent: 'chat' });
    mode = 'oversized';
    await assert.rejects(requestStructuredModel({ accountId: fixtureAccount('size'), prompt: 'Classify hello', schema }), /too large/);
    mode = 'stall';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    try {
        await assert.rejects(requestStructuredModel({ accountId: fixtureAccount('cancel'), prompt: 'Classify hello', schema, signal: controller.signal }), /cancel|timed out/);
    } finally { clearTimeout(timer); }
    mode = 'valid';
    for (let i = 0; i < 12; i++) await requestStructuredModel({ accountId: fixtureAccount('limit'), prompt: 'Classify hello', schema });
    const before = requests;
    await assert.rejects(requestStructuredModel({ accountId: fixtureAccount('limit'), prompt: 'Classify hello', schema }), /rate limit/);
    assert.equal(requests, before, 'Rate-limited request reached the provider');
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(requestStructuredModel({ accountId: fixtureAccount('pre-cancel'), prompt: 'Classify hello', schema, signal: cancelled.signal }), /cancel/);
    assert.equal(requests, before, 'Pre-cancelled request reached the provider');
    console.log('LOOPBACK_HTTP_MODEL_STRUCTURE_SIZE_STREAM_ABORT_AND_RATE_LIMIT_OK');
} finally {
    if (original.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original.key;
    if (original.url === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = original.url;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.env.REDIS_URL) {
        const { redis } = await import('../packages/happy-server/sources/storage/redis');
        redis.disconnect();
    }
}
