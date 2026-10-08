import { z } from 'zod';
import { invokeUserRpc, listConnectedUserRpcMethods } from '@/app/api/socket/rpcRegistry';

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_CHARS = 12_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const accountWindows = new Map<string, { start: number; count: number }>();

export class ModelUnavailableError extends Error {
    constructor(message = 'AI model is unavailable') { super(message); }
}

async function checkRateLimit(accountId: string) {
    if (process.env.REDIS_URL) {
        try {
            const { redis } = await import('@/storage/redis');
            const count = Number(await redis.eval(
                "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
                1, `ai:model-rate:${accountId}`, WINDOW_MS,
            ));
            if (count > MAX_REQUESTS_PER_WINDOW) throw new ModelUnavailableError('AI request rate limit exceeded');
            return;
        } catch (error) {
            if (error instanceof ModelUnavailableError) throw error;
            throw new ModelUnavailableError('AI request rate limiter is unavailable');
        }
    }
    const now = Date.now();
    if (accountWindows.size > 1_000) {
        for (const [key, window] of accountWindows) {
            if (now - window.start >= WINDOW_MS) accountWindows.delete(key);
        }
    }
    const current = accountWindows.get(accountId);
    if (!current || now - current.start >= WINDOW_MS) {
        accountWindows.set(accountId, { start: now, count: 1 });
        return;
    }
    if (current.count >= MAX_REQUESTS_PER_WINDOW) throw new ModelUnavailableError('AI request rate limit exceeded');
    current.count++;
}

function parseStructured<T>(raw: string, schema: z.ZodType<T>): T {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    if (Buffer.byteLength(trimmed) > MAX_RESPONSE_BYTES) throw new ModelUnavailableError('AI response is too large');
    try { return schema.parse(JSON.parse(trimmed)); }
    catch { throw new ModelUnavailableError('AI response has an invalid structure'); }
}

async function readLimited(response: Response, signal: AbortSignal): Promise<string> {
    if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) {
        throw new ModelUnavailableError('AI response is too large');
    }
    if (!response.body) throw new ModelUnavailableError('AI response is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            if (signal.aborted) throw new ModelUnavailableError('AI request timed out or was cancelled');
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_RESPONSE_BYTES) throw new ModelUnavailableError('AI response is too large');
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function hostedModel<T>(prompt: string, model: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new ModelUnavailableError();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST', signal: controller.signal,
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }] }),
        });
        if (!response.ok) throw new ModelUnavailableError(`AI provider returned HTTP ${response.status}`);
        const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });
        const parsed = envelope.parse(JSON.parse(await readLimited(response, controller.signal)));
        return parseStructured(parsed.choices[0].message.content, schema);
    } catch (error) {
        if (error instanceof ModelUnavailableError) throw error;
        if (controller.signal.aborted) throw new ModelUnavailableError('AI request timed out or was cancelled');
        throw new ModelUnavailableError('AI provider request failed');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

async function cliModel<T>(accountId: string, prompt: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const methods = new Set(listConnectedUserRpcMethods(accountId));
    const machine = [...methods].find((method) => method.endsWith(':ai-structured-model'))
        ?.slice(0, -':ai-structured-model'.length);
    if (!machine) throw new ModelUnavailableError('No connected AI runtime for this account');
    if (signal?.aborted) throw new ModelUnavailableError('AI request was cancelled');
    let response: { success?: boolean; text?: string };
    try {
        response = await invokeUserRpc(accountId, `${machine}:ai-structured-model`,
            { prompt, timeoutMs: 25_000, maxResponseBytes: MAX_RESPONSE_BYTES }, TIMEOUT_MS) as typeof response;
    } catch {
        throw new ModelUnavailableError('Connected AI runtime did not respond');
    }
    if (signal?.aborted) throw new ModelUnavailableError('AI request was cancelled');
    if (!response?.success || typeof response.text !== 'string') throw new ModelUnavailableError('Connected AI runtime failed');
    if (Buffer.byteLength(response.text) > MAX_RESPONSE_BYTES) throw new ModelUnavailableError('AI response is too large');
    return parseStructured(response.text, schema);
}

export async function requestStructuredModel<T>(input: {
    accountId: string; prompt: string; schema: z.ZodType<T>; model?: string; signal?: AbortSignal;
}): Promise<T> {
    if (input.prompt.length > MAX_REQUEST_CHARS) throw new ModelUnavailableError('AI request is too large');
    await checkRateLimit(input.accountId);
    if (input.signal?.aborted) throw new ModelUnavailableError('AI request was cancelled');
    if (process.env.OPENAI_API_KEY?.trim()) {
        return hostedModel(input.prompt, input.model || process.env.OPENAI_MODEL || 'gpt-4o-mini', input.schema, input.signal);
    }
    return cliModel(input.accountId, input.prompt, input.schema, input.signal);
}
