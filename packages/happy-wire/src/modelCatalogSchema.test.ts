import { describe, expect, it } from 'vitest';
import catalogJson from './modelCatalog.json';
import { ModelCatalogSchema, type ModelCatalogEntry } from './modelCatalogSchema';
import {
    BUNDLED_MODEL_CATALOG,
    getCodexModelOptions,
    getValidModelModesForAgent,
    isModelMode,
} from './modelCatalog';

function withModel(patch: Partial<ModelCatalogEntry>) {
    const base = BUNDLED_MODEL_CATALOG.models[0];
    return { ...catalogJson, models: [...catalogJson.models, { ...base, id: 'claude-test', ...patch }] };
}

describe('modelCatalogSchema', () => {
    it('accepts the bundled catalog', () => {
        expect(ModelCatalogSchema.safeParse(catalogJson).success).toBe(true);
    });

    it('rejects duplicate ids', () => {
        expect(ModelCatalogSchema.safeParse(withModel({ id: 'claude-opus-5' })).success).toBe(false);
    });

    it('rejects flags that do not fit the agent', () => {
        expect(ModelCatalogSchema.safeParse(withModel({ efforts: ['ultra', 'high'] })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ agent: 'gemini', efforts: [], context1m: 'optin' })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ context1m: 'optin', accepts1mSuffix: true })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ fastPricing: { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 } })).success).toBe(false);
    });

    it('requires an exact Codex CLI version', () => {
        for (const version of ['latest', '^0.155.0', '0.155']) {
            const catalog = { ...catalogJson, codexCli: { ...catalogJson.codexCli, version } };
            expect(ModelCatalogSchema.safeParse(catalog).success).toBe(false);
        }
        const beta = { ...catalogJson, codexCli: { ...catalogJson.codexCli, version: '0.156.0-beta.2' } };
        expect(ModelCatalogSchema.safeParse(beta).success).toBe(true);
    });

    it('requires a description on active models', () => {
        expect(ModelCatalogSchema.safeParse(withModel({ description: undefined })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ description: undefined, status: 'retired' })).success).toBe(true);
    });

    it('derives effort modes for every active model', () => {
        for (const model of BUNDLED_MODEL_CATALOG.models) {
            if (model.status !== 'active') continue;
            if (model.agent !== 'codex') expect(isModelMode(model.id)).toBe(true);
            for (const effort of model.efforts) expect(isModelMode(`${model.id}-${effort}`)).toBe(true);
        }
    });

    it('keeps the [1m] family for opt-in and legacy-suffix Claude models only', () => {
        expect(getValidModelModesForAgent('claude')).toContain('claude-opus-4-7[1m]-high');
        expect(getValidModelModesForAgent('claude')).toContain('claude-opus-4-8[1m]-high');
        expect(getValidModelModesForAgent('claude')).not.toContain('claude-opus-5[1m]');
        expect(getValidModelModesForAgent('claude')).not.toContain('claude-haiku-4-5-low');
    });

    it('applies per-model effort descriptions over the defaults', () => {
        const describe = (value: string) => getCodexModelOptions().find((option) => option.value === value)?.description;
        expect(describe('gpt-5.6-luna-low')).toBe('Fastest responses');
        expect(describe('gpt-5.5-xhigh')).toBe('Best quality');
        expect(describe('gpt-5.5-low')).toBe('Fast responses');
        expect(describe('gpt-6-astra-ultra')).toBe('Maximum reasoning with automatic task delegation');
    });
});
