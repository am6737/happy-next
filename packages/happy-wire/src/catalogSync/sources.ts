import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelPricing } from '../modelCatalogSchema';
import type { ClaudeUpstreamModel, CodexUpstreamModel } from './syncCatalog';

/** basellm/llm-metadata (models.dev + community fixes, first-party prices only): GitHub Pages, then its Cloudflare mirror. */
const ANTHROPIC_METADATA_URLS = [
    'https://basellm.github.io/llm-metadata/api/providers/anthropic.json',
    'https://llm-metadata.pages.dev/api/providers/anthropic.json',
];
const CODEX_TIMEOUT_MS = 180_000;
const CLAUDE_MODEL_ID = /^claude-(fable|opus|sonnet|haiku)-\d{1,2}(?:-\d{1,2})?$/;
const CLAUDE_EFFORTS_STRONGEST_FIRST = ['max', 'xhigh', 'high', 'medium', 'low'] as const;

/**
 * Environment for npm/npx children without the `npm_config_*` variables yarn
 * injects: its `npm_config_registry` points npx at another registry, which
 * misses the npm cache and re-downloads the whole Codex binary.
 */
const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('npm_config_')));

/**
 * Models offered by the pinned Codex CLI, from its app-server `model/list`
 * (works without signing in). Hidden models are left out.
 */
export async function fetchCodexModels(packageSpec: string): Promise<CodexUpstreamModel[]> {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-model-list-'));
    const child = spawn('npx', ['-y', packageSpec, 'app-server'], {
        env: { ...npmEnv, CODEX_HOME: codexHome },
        stdio: ['pipe', 'pipe', 'ignore'],
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    try {
        return await new Promise<CodexUpstreamModel[]>((resolve, reject) => {
            const models: CodexUpstreamModel[] = [];
            const timeout = setTimeout(() => reject(new Error(`no model/list answer from ${packageSpec} within ${CODEX_TIMEOUT_MS / 1000}s`)), CODEX_TIMEOUT_MS);
            let buffer = '';
            let nextId = 1;
            const requestPage = (cursor?: string) => send({ method: 'model/list', id: nextId++, params: cursor ? { cursor } : {} });
            child.on('error', reject);
            child.on('exit', (code) => reject(new Error(`${packageSpec} app-server exited with code ${code}`)));
            child.stdout.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const message = JSON.parse(line);
                    if (message.id === 0) {
                        send({ method: 'initialized' });
                        requestPage();
                    } else if (typeof message.id === 'number' && message.id > 0) {
                        if (message.error) {
                            clearTimeout(timeout);
                            reject(new Error(`model/list failed: ${JSON.stringify(message.error)}`));
                            return;
                        }
                        for (const model of message.result.data) {
                            if (model.hidden) continue;
                            models.push({
                                id: model.id,
                                displayName: model.displayName,
                                description: model.description,
                                efforts: model.supportedReasoningEfforts.map((effort: { reasoningEffort: string }) => effort.reasoningEffort),
                            });
                        }
                        if (message.result.nextCursor) {
                            requestPage(message.result.nextCursor);
                        } else {
                            clearTimeout(timeout);
                            resolve(models);
                        }
                    }
                }
            });
            send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'happy-model-catalog-sync', version: '1' } } });
        });
    } finally {
        child.kill();
        rmSync(codexHome, { recursive: true, force: true });
    }
}

type MetadataCost = { input?: number; output?: number; cache_write?: number; cache_read?: number };
type MetadataModel = {
    id: string;
    name?: string;
    status?: string;
    cost?: MetadataCost;
    limit?: { context?: number };
    reasoning_options?: Array<{ type: string; values?: string[] }>;
    experimental?: { modes?: { fast?: { cost?: MetadataCost } } };
};

/** Catalog pricing from an llm-metadata `cost` (USD per million tokens), if complete. */
function toPricing(cost: MetadataCost | undefined): ModelPricing | undefined {
    if (cost?.input === undefined || cost.output === undefined || cost.cache_write === undefined || cost.cache_read === undefined) return undefined;
    return { input: cost.input, output: cost.output, cacheWrite: cost.cache_write, cacheRead: cost.cache_read };
}

/**
 * Claude models from an llm-metadata provider file: official prices (standard
 * and fast mode), supported efforts, context window, name and lifecycle status.
 * A model whose reasoning options lack `effort` (e.g. Haiku 4.5, which only
 * takes a thinking budget) has no efforts.
 */
export function parseClaudeMetadata(data: { models: Record<string, MetadataModel> }): ClaudeUpstreamModel[] {
    return Object.values(data.models)
        .filter((model) => CLAUDE_MODEL_ID.test(model.id))
        .map((model) => {
            // No reasoning options at all means upstream doesn't say; options without `effort` mean none.
            const effort = model.reasoning_options && (model.reasoning_options.find((option) => option.type === 'effort')?.values ?? []);
            return {
                id: model.id,
                name: model.name,
                contextWindow: model.limit?.context,
                efforts: effort && CLAUDE_EFFORTS_STRONGEST_FIRST.filter((level) => effort.includes(level)),
                pricing: toPricing(model.cost),
                fastPricing: toPricing(model.experimental?.modes?.fast?.cost),
                deprecated: model.status === 'deprecated',
            };
        });
}

/** Claude models from basellm/llm-metadata, trying its mirror when GitHub Pages fails. */
export async function fetchClaudeMetadata(): Promise<ClaudeUpstreamModel[]> {
    const errors: string[] = [];
    for (const url of ANTHROPIC_METADATA_URLS) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return parseClaudeMetadata(await response.json() as { models: Record<string, MetadataModel> });
        } catch (error) {
            errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(errors.join('; '));
}

/** Model ids Gemini CLI accepts, read from the latest @google/gemini-cli-core package. */
export async function fetchGeminiCliModels(): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-core-'));
    try {
        const tarball = execFileSync('npm', ['pack', '@google/gemini-cli-core', '--silent'], { cwd: dir, encoding: 'utf-8', env: npmEnv }).trim().split('\n').pop()!;
        execFileSync('tar', ['xzf', tarball], { cwd: dir });
        const models = await import(pathToFileURL(join(dir, 'package/dist/src/config/models.js')).href);
        return [...(models.VALID_GEMINI_MODELS as Set<string>)];
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
