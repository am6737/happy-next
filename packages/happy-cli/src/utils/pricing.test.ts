import { describe, expect, it } from 'vitest';
import { calculateCost } from './pricing';

const usage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
};

describe('calculateCost', () => {
    it('uses current Claude 5 pricing for exact model IDs', () => {
        expect(calculateCost(usage, 'claude-fable-5-1')).toEqual({ total: 60, input: 10, output: 50 });
        expect(calculateCost(usage, 'claude-fable-5')).toEqual({ total: 60, input: 10, output: 50 });
        expect(calculateCost(usage, 'claude-opus-5')).toEqual({ total: 30, input: 5, output: 25 });
        expect(calculateCost(usage, 'claude-sonnet-5')).toEqual({ total: 12, input: 2, output: 10 });
    });

    it('recognizes provider-specific Claude 5 model IDs', () => {
        const cachedUsage = { ...usage, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 };
        expect(calculateCost(cachedUsage, 'provider/claude-fable-5-1').input).toBe(0.25);
        expect(calculateCost(usage, 'provider/claude-opus-5-20260701').total).toBe(30);
        expect(calculateCost(usage, 'provider/claude-sonnet-5-20260701').total).toBe(12);
    });
});
