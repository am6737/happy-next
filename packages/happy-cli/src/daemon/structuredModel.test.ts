import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStructuredModelHandler } from './structuredModel';

const originalHome = process.env.CODEX_HOME;
afterEach(() => { if (originalHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalHome; });

describe('pure structured model RPC', () => {
  it('uses configured HTTP provider without tools or server credential disclosure', async () => {
    const home = mkdtempSync(join(tmpdir(), 'happy-pure-model-'));
    let received: any;
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      received = { body: JSON.parse(body), auth: request.headers.authorization, path: request.url };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: '{"intent":"chat"}' }] }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      writeFileSync(join(home, 'config.toml'), `model_provider = "api"\nmodel = "real-model"\n[model_providers.api]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n`);
      writeFileSync(join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-only-secret' }));
      process.env.CODEX_HOME = home;
      const result = await createStructuredModelHandler().handle({ prompt: 'Classify this', timeoutMs: 5000, maxResponseBytes: 4096 });
      expect(result).toEqual({ success: true, text: '{"intent":"chat"}' });
      expect(received).toEqual({ path: '/v1/responses', auth: 'Bearer test-only-secret',
        body: { model: 'real-model', input: 'Classify this', tools: [], tool_choice: 'none' } });
      expect(JSON.stringify(result)).not.toContain('test-only-secret');
    } finally { server.close(); rmSync(home, { recursive: true, force: true }); }
  });
  it('fails closed without a configured provider or on oversized input', async () => {
    const home = mkdtempSync(join(tmpdir(), 'happy-pure-model-'));
    try {
      process.env.CODEX_HOME = home;
      const handler = createStructuredModelHandler();
      await expect(handler.handle({ prompt: 'hello', timeoutMs: 5000, maxResponseBytes: 4096 }))
        .resolves.toEqual({ success: false, error: 'PURE_MODEL_UNAVAILABLE' });
      await expect(handler.handle({ prompt: 'x'.repeat(12001), timeoutMs: 5000, maxResponseBytes: 4096 }))
        .resolves.toEqual({ success: false, error: 'PURE_MODEL_UNAVAILABLE' });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  it.each([
    { status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial' }] }] },
    { status: 'failed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'failed' }] }] },
    { status: 'completed', output: [{ type: 'function_call', name: 'shell' }, { type: 'message', content: [{ type: 'output_text', text: 'unsafe' }] }] },
  ])('rejects incomplete or tool-bearing Responses envelope', async (envelope) => {
    const home = mkdtempSync(join(tmpdir(), 'happy-pure-model-'));
    const server = createServer((_request, response) => response.end(JSON.stringify(envelope)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      writeFileSync(join(home, 'config.toml'), `model_provider = "api"\nmodel = "model"\n[model_providers.api]\nbase_url = "http://127.0.0.1:${address.port}"\nwire_api = "responses"\nenv_key = "HAPPY_TEST_MODEL_KEY"\n`);
      process.env.CODEX_HOME = home;
      process.env.HAPPY_TEST_MODEL_KEY = 'test-only';
      await expect(createStructuredModelHandler().handle({ prompt: 'test', timeoutMs: 5000, maxResponseBytes: 4096 }))
        .resolves.toEqual({ success: false, error: 'PURE_MODEL_UNAVAILABLE' });
    } finally { server.close(); rmSync(home, { recursive: true, force: true }); delete process.env.HAPPY_TEST_MODEL_KEY; }
  });
  it.each([
    { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'unsafe', tool_calls: [{ id: 'call' }] } }] },
  ])('rejects unfinished or tool-bearing Chat envelope', async (envelope) => {
    const home = mkdtempSync(join(tmpdir(), 'happy-pure-model-'));
    const server = createServer((_request, response) => response.end(JSON.stringify(envelope)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      writeFileSync(join(home, 'config.toml'), `model_provider = "api"\nmodel = "model"\n[model_providers.api]\nbase_url = "http://127.0.0.1:${address.port}"\nwire_api = "chat"\nenv_key = "HAPPY_TEST_MODEL_KEY"\n`);
      process.env.CODEX_HOME = home;
      process.env.HAPPY_TEST_MODEL_KEY = 'test-only';
      await expect(createStructuredModelHandler().handle({ prompt: 'test', timeoutMs: 5000, maxResponseBytes: 4096 }))
        .resolves.toEqual({ success: false, error: 'PURE_MODEL_UNAVAILABLE' });
    } finally { server.close(); rmSync(home, { recursive: true, force: true }); delete process.env.HAPPY_TEST_MODEL_KEY; }
  });
});
