import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLED_MODEL_CATALOG } from '../modelCatalog';
import { type ModelCatalog, type ModelCatalogEntry, ModelCatalogSchema } from '../modelCatalogSchema';
import { parseClaudeMetadata } from './sources';
import { type CodexUpstreamModel, formatCatalogJson, formatSyncReport, hasCatalogChanges, syncCatalog } from './syncCatalog';

const opusPricing = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
const claude = (id: string, label: string, extra: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry => ({
    id, agent: 'claude', status: 'active', label, displayName: `Claude ${label}`, description: `${label} description`,
    efforts: ['max', 'xhigh', 'high', 'medium', 'low'], contextWindow: 1_000_000, context1m: 'always', pricing: opusPricing, ...extra,
});
const codex = (id: string, label: string, extra: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry => ({
    id, agent: 'codex', status: 'active', label, shortLabel: label.replace(/^GPT-/, ''), displayName: label, description: `${label} description`,
    efforts: ['xhigh', 'high', 'medium', 'low'], contextWindow: 272_000, ...extra,
});

/** A small catalog independent of the real data, which the sync itself keeps changing. */
const catalog: ModelCatalog = {
    ...BUNDLED_MODEL_CATALOG,
    models: [
        claude('claude-opus-5', 'Opus 5', { fastMode: true, fastPricing: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 } }),
        claude('claude-opus-4-7', 'Opus 4.7', { contextWindow: 200_000, context1m: 'optin' }),
        claude('claude-haiku-4-5', 'Haiku 4.5', { efforts: [], contextWindow: 200_000, context1m: undefined }),
        codex('gpt-6-astra', 'GPT-6-Astra', { contextWindow: 1_050_000 }),
        codex('gpt-5.6-sol', 'GPT-5.6-Sol'),
        codex('gpt-5.6-luna', 'GPT-5.6-Luna', { efforts: ['max', 'xhigh', 'high', 'medium', 'low'], effortDescriptions: { low: 'Fastest', medium: 'Balanced', high: 'Better' } }),
        codex('gpt-5.5', 'GPT-5.5'),
        codex('gpt-5.4', 'GPT-5.4', { status: 'retired', description: undefined }),
        { id: 'gemini-3.8-flash', agent: 'gemini', status: 'active', label: '3.8 Flash', displayName: 'Gemini 3.8 Flash', description: 'Flash', efforts: [], contextWindow: 1_048_576 },
    ],
};
const noSources = { codex: null, claude: null, gemini: null };
const ids = (agent: string, result = catalog) => result.models.filter((model) => model.agent === agent && model.status === 'active').map((model) => model.id);
const model = (id: string, result = catalog) => result.models.find((entry) => entry.id === id)!;

/** Codex upstream mirroring the catalog, so tests change one thing at a time. */
function codexUpstream(): CodexUpstreamModel[] {
    return catalog.models
        .filter((entry) => entry.agent === 'codex' && entry.status === 'active')
        .map((entry) => ({ id: entry.id, displayName: entry.displayName, description: entry.description!, efforts: [...entry.efforts].reverse() }));
}

describe('syncCatalog', () => {
    it('uses a valid fixture catalog', () => {
        expect(ModelCatalogSchema.safeParse(catalog).success).toBe(true);
    });

    it('changes nothing when upstream matches the catalog or every source failed', () => {
        for (const upstream of [noSources, { ...noSources, codex: codexUpstream() }]) {
            const result = syncCatalog(catalog, upstream);
            expect(result.catalog).toEqual(catalog);
            expect(hasCatalogChanges(result.report)).toBe(false);
        }
    });

    it('adds new Codex models in Codex order, borrowing the context window of the same generation', () => {
        const upstream = codexUpstream();
        upstream.splice(1, 0, { id: 'gpt-6-sol', displayName: 'GPT-6-Sol', description: 'Workhorse model.', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] });

        const result = syncCatalog(catalog, { ...noSources, codex: upstream });

        expect(ids('codex', result.catalog).slice(0, 3)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol']);
        expect(model('gpt-6-sol', result.catalog)).toMatchObject({
            status: 'active',
            label: 'GPT-6-Sol',
            shortLabel: '6-Sol',
            efforts: ['ultra', 'max', 'xhigh', 'high', 'medium', 'low'],
            contextWindow: model('gpt-6-astra').contextWindow,
        });
        expect(result.report.added).toHaveLength(1);
        expect(result.report.review.join('\n')).toContain('gpt-6-sol');
    });

    it('falls back to the same tier for a new Codex generation', () => {
        const upstream = [...codexUpstream(), { id: 'gpt-7-luna', displayName: 'GPT-7-Luna', description: 'Next Luna.', efforts: ['low', 'medium'] }];
        const result = syncCatalog(catalog, { ...noSources, codex: upstream });
        expect(model('gpt-7-luna', result.catalog).contextWindow).toBe(model('gpt-5.6-luna').contextWindow);
    });

    it('retires Codex models Codex no longer lists, and follows its descriptions and efforts', () => {
        const upstream = codexUpstream().filter((entry) => entry.id !== 'gpt-5.5');
        upstream[0] = { ...upstream[0], description: 'New copy.' };
        const luna = upstream.find((entry) => entry.id === 'gpt-5.6-luna')!;
        luna.efforts = ['medium', 'high'];

        const result = syncCatalog(catalog, { ...noSources, codex: upstream });

        expect(model('gpt-5.5', result.catalog).status).toBe('retired');
        expect(result.report.retired).toHaveLength(1);
        expect(model('gpt-6-astra', result.catalog).description).toBe('New copy.');
        // Effort descriptions for efforts the model lost are dropped; the rest stay.
        expect(model('gpt-5.6-luna', result.catalog)).toMatchObject({
            efforts: ['high', 'medium'],
            effortDescriptions: { medium: 'Balanced', high: 'Better' },
        });
        expect(ModelCatalogSchema.safeParse(result.catalog).success).toBe(true);
    });

    it('adds a Claude successor before the model it copies, and ignores older or dated ids', () => {
        const pricing = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
        const result = syncCatalog(catalog, {
            ...noSources,
            claude: [
                { id: 'claude-opus-5-5', contextWindow: 1_000_000, pricing },
                { id: 'claude-opus-4-5', contextWindow: 200_000, pricing },
                { id: 'claude-mythos-5-1', contextWindow: 1_000_000, pricing },
            ],
        });

        const claudeIds = ids('claude', result.catalog);
        expect(claudeIds.indexOf('claude-opus-5-5')).toBe(claudeIds.indexOf('claude-opus-5') - 1);
        expect(claudeIds).not.toContain('claude-opus-4-5');
        expect(claudeIds).not.toContain('claude-mythos-5-1');
        expect(model('claude-opus-5-5', result.catalog)).toMatchObject({
            label: 'Opus 5.5',
            displayName: 'Claude Opus 5.5',
            efforts: model('claude-opus-5').efforts,
            context1m: 'always',
            pricing,
        });
        expect(model('claude-opus-5-5', result.catalog).fastMode).toBeUndefined();
        expect(result.report.review.some((note) => note.includes('upstream lists no efforts'))).toBe(true);
        expect(ModelCatalogSchema.safeParse(result.catalog).success).toBe(true);
    });

    it('takes the official name, efforts and fast mode of a new Claude model', () => {
        const fastPricing = { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.4 };
        const result = syncCatalog(catalog, {
            ...noSources,
            claude: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 1_000_000, efforts: ['max', 'high'], pricing: opusPricing, fastPricing }],
        });
        expect(model('claude-opus-5-5', result.catalog)).toMatchObject({ label: 'Opus 5.5', efforts: ['max', 'high'], fastMode: true, fastPricing });
        expect(ModelCatalogSchema.safeParse(result.catalog).success).toBe(true);
    });

    it('syncs fast mode pricing, and only reports dropped fast mode or deprecation', () => {
        const fastPricing = { input: 12, output: 60, cacheWrite: 15, cacheRead: 1.2 };
        const result = syncCatalog(catalog, {
            ...noSources,
            claude: [
                { id: 'claude-opus-5', pricing: opusPricing, deprecated: true },
                { id: 'claude-opus-4-7', pricing: opusPricing, fastPricing },
                { id: 'claude-haiku-4-5', pricing: opusPricing },
            ],
        });
        expect(model('claude-opus-4-7', result.catalog)).toMatchObject({ fastMode: true, fastPricing });
        // Fast mode missing upstream is a review note, not a removal.
        expect(model('claude-opus-5', result.catalog)).toMatchObject({ fastMode: true, fastPricing: model('claude-opus-5').fastPricing });
        expect(result.report.review.some((note) => note.includes('no longer lists fast mode'))).toBe(true);
        expect(result.report.review.some((note) => note.includes('deprecated upstream'))).toBe(true);
        // No efforts upstream keeps the catalog's efforts.
        expect(model('claude-haiku-4-5', result.catalog).efforts).toEqual([]);
        expect(model('claude-opus-5', result.catalog).efforts).toEqual(model('claude-opus-5').efforts);
    });

    it('updates Claude prices and Models API efforts, but not context windows', () => {
        const pricing = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 };
        const result = syncCatalog(catalog, {
            ...noSources,
            claude: [
                { id: 'claude-opus-5', pricing },
                { id: 'claude-opus-4-7', contextWindow: 1_000_000, efforts: ['max', 'high', 'medium', 'low'] },
            ],
        });

        expect(model('claude-opus-5', result.catalog).pricing).toEqual(pricing);
        expect(model('claude-opus-4-7', result.catalog)).toMatchObject({ contextWindow: 200_000, efforts: ['max', 'high', 'medium', 'low'] });
        expect(result.report.updated).toHaveLength(2);
    });

    it('never touches the Codex CLI version', () => {
        const upstream = codexUpstream().slice(1);
        const result = syncCatalog(catalog, { ...noSources, codex: upstream, claude: [{ id: 'claude-opus-6' }] });
        expect(result.catalog.codexCli).toEqual(catalog.codexCli);
    });

    it('lists Gemini CLI models missing from the catalog without adding them', () => {
        const result = syncCatalog(catalog, { ...noSources, gemini: ['gemini-3.8-flash', 'gemini-4-pro', 'gemini-3.1-pro-preview-customtools', 'gemma-4-31b-it', 'none'] });
        expect(result.report.geminiCandidates).toEqual(['gemini-4-pro']);
        expect(result.catalog).toEqual(catalog);
        expect(formatSyncReport(result.report, [])).toContain('`gemini-4-pro`');
    });
});

describe('parseClaudeMetadata', () => {
    it('reads prices, fast mode, efforts and status from llm-metadata', () => {
        const cost = { input: 4, output: 20, cache_write: 5, cache_read: 0.2 };
        const parsed = parseClaudeMetadata({
            models: {
                'claude-opus-5-5': {
                    id: 'claude-opus-5-5', name: 'Claude Opus 5.5', cost, limit: { context: 1_000_000 },
                    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
                    experimental: { modes: { fast: { cost: { input: 8, output: 40, cache_write: 10, cache_read: 0.4 } } } },
                },
                'claude-haiku-4-5': { id: 'claude-haiku-4-5', cost, reasoning_options: [{ type: 'budget_tokens' }], status: 'deprecated' },
                'claude-opus-4-1': { id: 'claude-opus-4-1', cost },
                'claude-haiku-4-5-20251001': { id: 'claude-haiku-4-5-20251001', cost },
            },
        });
        expect(parsed).toEqual([
            {
                id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 1_000_000,
                efforts: ['max', 'xhigh', 'high', 'medium', 'low'],
                pricing: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
                fastPricing: { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.4 },
                deprecated: false,
            },
            { id: 'claude-haiku-4-5', name: undefined, contextWindow: undefined, efforts: [], pricing: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }, fastPricing: undefined, deprecated: true },
            { id: 'claude-opus-4-1', name: undefined, contextWindow: undefined, efforts: undefined, pricing: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }, fastPricing: undefined, deprecated: false },
        ]);
    });
});

describe('formatCatalogJson', () => {
    it('reproduces the hand-written catalog file exactly', () => {
        const file = readFileSync(fileURLToPath(new URL('../modelCatalog.json', import.meta.url)), 'utf-8');
        expect(formatCatalogJson(ModelCatalogSchema.parse(JSON.parse(file)))).toBe(file);
    });
});
