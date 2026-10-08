import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

type Request = { prompt: string; timeoutMs: number; maxResponseBytes: number };
type Config = { baseUrl: string; model: string; wireApi: 'responses' | 'chat'; key: string };
const MAX_PROMPT_CHARS = 12_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 25_000;

function scalar(raw: string): string | boolean {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"')) return JSON.parse(value) as string;
  if (value.startsWith("'")) throw new Error('Unsupported provider configuration');
  throw new Error('Unsupported provider configuration');
}

// Only the supported scalar subset is read; complex provider configuration fails closed.
function readCodexConfig(): Config {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  const source = readFileSync(join(home, 'config.toml'), 'utf8');
  if (source.length > 64_000) throw new Error('Provider configuration is too large');
  const top = new Map<string, string | boolean>();
  const providers = new Map<string, Map<string, string | boolean>>();
  let section = '';
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      section = line.slice(1, -1);
      continue;
    }
    const match = line.match(/^([a-zA-Z_][\w-]*)\s*=\s*(.*)$/);
    if (!match) continue;
    if (section && !section.startsWith('model_providers.')) continue;
    if (!['model_provider', 'model', 'base_url', 'wire_api', 'requires_openai_auth', 'env_key'].includes(match[1])) continue;
    const target = section ? (providers.get(section.slice('model_providers.'.length)) ?? new Map()) : top;
    if (target.has(match[1])) throw new Error('Duplicate provider configuration');
    target.set(match[1], scalar(match[2]));
    if (section) providers.set(section.slice('model_providers.'.length), target);
  }
  const providerName = top.get('model_provider');
  const model = top.get('model');
  if (typeof providerName !== 'string' || typeof model !== 'string') throw new Error('Codex provider/model is not configured');
  const provider = providers.get(providerName);
  if (!provider) throw new Error('Codex provider is unavailable for pure HTTP inference');
  const baseUrl = provider.get('base_url');
  const wireApi = provider.get('wire_api');
  if (typeof baseUrl !== 'string' || (wireApi !== 'responses' && wireApi !== 'chat')) throw new Error('Unsupported Codex HTTP provider');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)))
    throw new Error('Provider URL must use HTTPS');
  if (url.username || url.password) throw new Error('Provider URL must not embed credentials');
  const envKey = provider.get('env_key');
  let key: string | undefined;
  if (typeof envKey === 'string') key = process.env[envKey];
  else if (provider.get('requires_openai_auth') === true) {
    const auth = z.object({ OPENAI_API_KEY: z.string().min(1) }).parse(JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')));
    key = auth.OPENAI_API_KEY;
  }
  if (!key) throw new Error('Configured provider authentication is unavailable');
  return { baseUrl: baseUrl.replace(/\/$/, ''), model, wireApi, key };
}

async function readLimited(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Provider response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new Error('Provider request cancelled');
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maxBytes) throw new Error('Provider response is too large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createStructuredModelHandler() {
  const active = new Set<AbortController>();
  return {
    cancelAll: () => { for (const controller of active) controller.abort(); },
    handle: async (input: Request): Promise<{ success: true; text: string } | { success: false; error: string }> => {
      try {
        if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > MAX_PROMPT_CHARS
          || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > MAX_TIMEOUT_MS
          || !Number.isInteger(input.maxResponseBytes) || input.maxResponseBytes < 1 || input.maxResponseBytes > MAX_RESPONSE_BYTES)
          throw new Error('Invalid structured model request');
        const config = readCodexConfig();
        const controller = new AbortController();
        active.add(controller);
        const timer = setTimeout(() => controller.abort(), input.timeoutMs);
        try {
          const response = await fetch(`${config.baseUrl}/${config.wireApi === 'responses' ? 'responses' : 'chat/completions'}`, {
            method: 'POST', signal: controller.signal,
            headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
            body: JSON.stringify(config.wireApi === 'responses'
              ? { model: config.model, input: input.prompt, tools: [], tool_choice: 'none' }
              : { model: config.model, messages: [{ role: 'user', content: input.prompt }], tools: [], tool_choice: 'none' }),
          });
          if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
          const envelope = await readLimited(response, input.maxResponseBytes, controller.signal);
          let text: string;
          if (config.wireApi === 'responses') {
            const parsed = z.object({ status: z.literal('completed'), output: z.array(z.object({
              type: z.enum(['message', 'reasoning']),
              status: z.string().optional(),
              content: z.array(z.object({ type: z.literal('output_text'), text: z.string() })).optional(),
            })).min(1) }).parse(envelope);
            if (parsed.output.some((item) => item.type === 'message' && item.status && item.status !== 'completed'))
              throw new Error('Provider message is incomplete');
            const messages = parsed.output.filter((item) => item.type === 'message');
            if (messages.length !== 1 || !messages[0].content?.length) throw new Error('Provider returned no single final message');
            text = messages[0].content.map((item) => item.text).join('\n');
          } else {
            const parsed = z.object({ choices: z.array(z.object({
              finish_reason: z.literal('stop'), message: z.object({ content: z.string(), tool_calls: z.never().optional(), function_call: z.never().optional() }),
            })).length(1) }).parse(envelope);
            text = parsed.choices[0].message.content;
          }
          if (!text.trim() || Buffer.byteLength(text) > input.maxResponseBytes) throw new Error('Provider returned invalid text');
          return { success: true, text: text.trim() };
        } finally { clearTimeout(timer); active.delete(controller); }
      } catch { return { success: false, error: 'PURE_MODEL_UNAVAILABLE' }; }
    },
  };
}
