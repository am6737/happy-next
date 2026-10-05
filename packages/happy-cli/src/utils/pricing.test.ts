import { describe, expect, it } from 'vitest';
import { calculateCost } from './pricing';

const usage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
};

describe('calculateCost', () => {
    it.each([
        'claude-opus-4-5',
        'claude-opus-4-6',
        'claude-opus-4-7',
        'claude-opus-4-8',
        'claude-opus-4-8[1m]',
        'provider/claude-opus-4-6-20260205',
        'us.anthropic.claude-opus-4-8-v1:0',
        'claude-4.8-opus',
    ])('uses current Opus 4.x pricing for %s', (model) => {
        expect(calculateCost(usage, model)).toEqual({ total: 30, input: 5, output: 25 });
        const cachedUsage = { ...usage, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
        expect(calculateCost(cachedUsage, model)).toEqual({ total: 6.75, input: 6.75, output: 0 });
    });

    it.each(['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'provider/claude-haiku-4-5'])('uses Haiku 4.5 pricing for %s', (model) => {
        expect(calculateCost(usage, model)).toEqual({ total: 6, input: 1, output: 5 });
    });

    it('preserves legacy and unknown model pricing', () => {
        expect(calculateCost(usage, 'claude-opus-4-1').total).toBe(90);
        expect(calculateCost(usage, 'claude-4.1-opus').total).toBe(90);
        expect(calculateCost(usage, 'claude-opus-4-20250514').total).toBe(90);
        expect(calculateCost(usage, 'claude-3-5-haiku-latest').total).toBe(4.8);
        expect(calculateCost(usage, 'unknown-model').total).toBe(18);
    });

    it('uses current Claude 5 pricing for exact model IDs', () => {
        expect(calculateCost(usage, 'claude-fable-5-1')).toEqual({ total: 60, input: 10, output: 50 });
        expect(calculateCost(usage, 'claude-fable-5')).toEqual({ total: 60, input: 10, output: 50 });
        expect(calculateCost(usage, 'claude-opus-5')).toEqual({ total: 30, input: 5, output: 25 });
        expect(calculateCost(usage, 'claude-sonnet-5')).toEqual({ total: 12, input: 2, output: 10 });
    });

    it('charges fast mode rates for Claude Opus 5 and Claude Opus 4.8', () => {
        const cachedUsage = { ...usage, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
        for (const model of [
            'claude-opus-5-fast',
            'claude-opus-4-8-fast',
            'claude-4.8-opus-fast',
            'provider/claude-opus-5-fast',
            'us.anthropic.claude-opus-4-8-v1:0-fast',
            'claude-opus-5-fast-20260701',
        ]) {
            // $10 in / $50 out — 2x the standard Opus rate.
            expect(calculateCost(usage, model)).toEqual({ total: 60, input: 10, output: 50 });
            // Cache multipliers stack on top: 1.25x write + 0.1x read.
            expect(calculateCost(cachedUsage, model)).toEqual({ total: 13.5, input: 13.5, output: 0 });
        }
    });

    it('leaves models without fast mode on standard rates', () => {
        const cachedUsage = { ...usage, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
        // Opus 4.7 rejects fast mode and Opus 4.6 ignores it.
        expect(calculateCost(usage, 'claude-opus-4-7-fast').total).toBe(30);
        expect(calculateCost(usage, 'claude-opus-4-6-fast').total).toBe(30);
        expect(calculateCost(usage, 'claude-sonnet-5-fast').total).toBe(12);
        expect(calculateCost(usage, 'claude-haiku-4-5-fast').total).toBe(6);
        // Fable 5.1 keeps its own cache rate, not the fast mode one.
        expect(calculateCost(cachedUsage, 'claude-fable-5-1-fast').input).toBe(12.75);
    });

    it('recognizes provider-specific Claude 5 model IDs', () => {
        const cachedUsage = { ...usage, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 };
        expect(calculateCost(cachedUsage, 'provider/claude-fable-5-1').input).toBe(0.25);
        expect(calculateCost(usage, 'provider/claude-opus-5-20260701').total).toBe(30);
        expect(calculateCost(usage, 'provider/claude-sonnet-5-20260701').total).toBe(12);
    });
});
