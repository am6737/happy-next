import { getModelCatalog, type ModelPricing as CatalogPricing } from 'happy-wire';
import { Usage } from '../api/types';

/**
 * Pricing rates per million tokens for models that are no longer in the model
 * catalog. Current models carry their rates (and fast-mode rates) in the
 * happy-wire catalog instead.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (as of September 2026)
 */
export const PRICING = {
    // --- Claude 4 ---
    'claude-4.5-opus': {
        input: 5.0,
        output: 25.0,
        cache_write: 6.25,
        cache_read: 0.50
    },
    'claude-4.1-opus': {
        input: 15.0,
        output: 75.0,
        cache_write: 18.75,
        cache_read: 1.50
    },
    'claude-4-opus': {
        input: 15.0,
        output: 75.0,
        cache_write: 18.75,
        cache_read: 1.50
    },
    'claude-4.6-sonnet': {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.30
    },
    'claude-4.5-sonnet': {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.30
    },
    'claude-4-sonnet': {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.30
    },
    'claude-4.5-haiku': {
        input: 1.0,
        output: 5.0,
        cache_write: 1.25,
        cache_read: 0.10
    },

    // --- Legacy / Claude 3 ---
    'claude-3-opus-20240229': {
        input: 15.0,
        output: 75.0,
        cache_write: 18.75,
        cache_read: 1.5
    },
    'claude-3-sonnet-20240229': {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.3
    },
    'claude-3-5-sonnet-20240620': {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.3
    },
    // New Sonnet 3.5 updated model
    'claude-3-5-sonnet-20241022': {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.3
    },
    'claude-3-haiku-20240307': {
        input: 0.25,
        output: 1.25,
        cache_write: 0.3125,
        cache_read: 0.025
    },
    'claude-3-5-haiku-20241022': {
        input: 0.8,
        output: 4.0,
        cache_write: 1.0,  // Approx based on 1.25x rule usually or custom
        cache_read: 0.08
    }
} as const;

/** Standard per-million-token rates for one model. */
type ModelPricing = {
    readonly input: number;
    readonly output: number;
    readonly cache_write: number;
    readonly cache_read: number;
};

function toModelPricing(pricing: CatalogPricing): ModelPricing {
    return {
        input: pricing.input,
        output: pricing.output,
        cache_write: pricing.cacheWrite,
        cache_read: pricing.cacheRead,
    };
}

type CatalogRate = { key: string; pricing: ModelPricing };

/** Longest key first, so `claude-fable-5-1` wins over `claude-fable-5`. */
function byKeyLength(a: CatalogRate, b: CatalogRate): number {
    return b.key.length - a.key.length;
}

/**
 * Standard rates for catalog models, matched anywhere in the model id so dated
 * (`claude-opus-5-20260701`) and provider-prefixed ids resolve. Each model is
 * also keyed without its `claude-` prefix to catch ids like `opus-5`. Built from
 * the active catalog on every call, so a catalog fetched from the server applies.
 */
function catalogRates(): CatalogRate[] {
    return getModelCatalog().models.flatMap((model) => {
        if (!model.pricing) return [];
        const pricing = toModelPricing(model.pricing);
        const keys = new Set([model.id, model.id.replace(/^claude-/, '')]);
        return [...keys].map((key) => ({ key, pricing }));
    }).sort(byKeyLength);
}

/** Older names for fast-mode models that still appear in usage reports. */
const FAST_MODE_ALIASES: Record<string, string> = {
    'claude-4.8-opus': 'claude-opus-4-8',
};

/**
 * Fast mode (research preview) is billed at the catalog `fastPricing` rates
 * across the full context window. Prompt-caching multipliers apply on top.
 * Models without fast mode (e.g. Opus 4.7, which rejects it, or Opus 4.6,
 * which ignores it) stay on standard pricing.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing
 */
function fastModeRates(): CatalogRate[] {
    const rates = getModelCatalog().models.flatMap((model) =>
        model.fastPricing ? [{ key: model.id, pricing: toModelPricing(model.fastPricing) }] : []);
    const aliasRates = Object.entries(FAST_MODE_ALIASES).flatMap(([alias, id]) => {
        const rate = rates.find((candidate) => candidate.key === id);
        return rate ? [{ key: alias, pricing: rate.pricing }] : [];
    });
    return [...rates, ...aliasRates].sort(byKeyLength);
}

/** A trailing `-fast` marks a fast-mode request; a date suffix may follow it. */
const FAST_MODE_SUFFIX = /-fast(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/;

/** Premium rates for a fast-mode model id, or undefined for a standard model. */
function resolveFastModePricing(modelId: string): ModelPricing | undefined {
    if (!FAST_MODE_SUFFIX.test(modelId)) return undefined;
    const base = modelId.replace(FAST_MODE_SUFFIX, '');
    return fastModeRates().find((rate) => base.includes(rate.key))?.pricing;
}

/** Standard rates of the catalog model named in the id, or undefined. */
function resolveCatalogPricing(modelId: string): ModelPricing | undefined {
    return catalogRates().find((rate) => modelId.includes(rate.key))?.pricing;
}

export type ModelId = keyof typeof PRICING;

// Default to Sonnet 3.5 if unknown
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Calculate cost for usage
 * @param usage - Usage stats
 * @param modelId - Model ID (optional, defaults to Sonnet 3.5)
 */
export function calculateCost(usage: Usage, modelId?: string): { total: number, input: number, output: number } {
    const id = typeof modelId === 'string' ? modelId : '';
    let pricing: ModelPricing | undefined = resolveFastModePricing(id)
        ?? PRICING[id as ModelId]
        ?? resolveCatalogPricing(id);

    // Fallback if model not found
    if (!pricing) {
        // Try fuzzy matching for legacy aliases
        if (modelId?.includes('opus')) {
            if (/opus-4-[5-8](?:\D|$)|4\.[5-8](?:\D|$)/.test(modelId)) pricing = PRICING['claude-4.5-opus'];
            else if (modelId.includes('opus-4-1') || modelId.includes('4.1')) pricing = PRICING['claude-4.1-opus'];
            else if (modelId.includes('4')) pricing = PRICING['claude-4-opus'];
            else pricing = PRICING['claude-3-opus-20240229'];
        }
        else if (modelId?.includes('sonnet')) {
            if (modelId.includes('4.6')) pricing = PRICING['claude-4.6-sonnet'];
            else if (modelId.includes('4.5')) pricing = PRICING['claude-4.5-sonnet'];
            else if (modelId.includes('4')) pricing = PRICING['claude-4-sonnet'];
            else pricing = PRICING['claude-3-5-sonnet-20241022'];
        }
        else if (modelId?.includes('haiku')) {
            if (modelId.includes('haiku-4-5') || modelId.includes('4.5')) pricing = PRICING['claude-4.5-haiku'];
            else if (modelId.includes('3-5-haiku') || modelId.includes('3.5')) pricing = PRICING['claude-3-5-haiku-20241022'];
            else pricing = PRICING['claude-3-haiku-20240307'];
        }
        else pricing = PRICING[DEFAULT_MODEL];
    }

    const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
    const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;

    // Cache costs
    const cacheWriteCost = ((usage.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cache_write;
    const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1_000_000) * pricing.cache_read;

    const totalInputCost = inputCost + cacheWriteCost + cacheReadCost;

    return {
        total: totalInputCost + outputCost,
        input: totalInputCost,
        output: outputCost
    };
}
