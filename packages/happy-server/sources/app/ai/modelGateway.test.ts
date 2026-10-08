import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ methods: vi.fn(), rpc: vi.fn() }));
vi.mock('@/app/api/socket/rpcRegistry', () => ({
    listConnectedUserRpcMethods: mocks.methods,
    invokeUserRpc: mocks.rpc,
}));

import { requestStructuredModel } from './modelGateway';

const schema = z.object({ intent: z.enum(['chat', 'task']) });

describe('structured model gateway', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

    it('uses only the account-scoped structured model RPC', async () => {
        vi.stubEnv('OPENAI_API_KEY', '');
        mocks.methods.mockReturnValue(['machine-1:orchestrator-dispatch', 'machine-1:bash', 'machine-1:ai-structured-model']);
        mocks.rpc.mockResolvedValue({ success: true, text: '{"intent":"task"}' });
        expect(await requestStructuredModel({ accountId: 'cli-account', prompt: "Classify O'Hara", schema })).toEqual({ intent: 'task' });
        expect(mocks.rpc).toHaveBeenCalledWith('cli-account', 'machine-1:ai-structured-model', {
            prompt: "Classify O'Hara", timeoutMs: 25_000, maxResponseBytes: 65_536,
        }, 30_000);
        mocks.methods.mockReturnValue(['machine-1:bash']);
        await expect(requestStructuredModel({ accountId: 'cli-account-2', prompt: 'Classify', schema }))
            .rejects.toThrow('No connected AI runtime for this account');
    });

    it('reports an offline CLI without exposing a token or machine details', async () => {
        vi.stubEnv('OPENAI_API_KEY', '');
        mocks.methods.mockReturnValue([]);
        await expect(requestStructuredModel({ accountId: 'offline-account', prompt: 'Classify', schema }))
            .rejects.toThrow('No connected AI runtime for this account');
    });

    it('aborts a stalled hosted request and rejects an oversized response', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'test-key');
        vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })));
        const controller = new AbortController();
        const pending = requestStructuredModel({ accountId: 'abort-account', prompt: 'Classify', schema, signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toThrow('AI request was cancelled');

        vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-length': '999999' } })));
        await expect(requestStructuredModel({ accountId: 'size-account', prompt: 'Classify', schema }))
            .rejects.toThrow('AI response is too large');
    });

    it('rejects invalid structured output and oversized prompts', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'test-key');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"delete"}' } }] }))));
        await expect(requestStructuredModel({ accountId: 'shape-account', prompt: 'Classify', schema }))
            .rejects.toThrow('AI response has an invalid structure');
        await expect(requestStructuredModel({ accountId: 'large-account', prompt: 'a'.repeat(12_001), schema }))
            .rejects.toThrow('AI request is too large');
    });
});
