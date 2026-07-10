import { describe, expect, it } from 'vitest';
import {
    buildCodexModelMode,
    CODEX_MODEL_MODES,
    GEMINI_MODEL_MODES,
    getCodexReasoningOptions,
    getMaxContextSize,
    isModelMode,
    isModelModeForAgent,
    MODEL_MODE_DEFAULT,
    parseCodexModelMode,
    resolveModelSelectionForFlavor,
} from './modelCatalog';

describe('modelCatalog', () => {
    it('validates model mode and flavor-specific mode', () => {
        expect(isModelMode('gpt-5.6-sol-ultra')).toBe(true);
        expect(isModelMode('gpt-5.5-xhigh')).toBe(true);
        expect(isModelMode('unknown-model')).toBe(false);

        expect(isModelModeForAgent('codex', 'gpt-5.6-sol-ultra')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gpt-5.6-sol-ultra')).toBe(false);
        expect(isModelModeForAgent('claude', 'claude-opus-4-6')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8[1m]-xhigh')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-2.5-flash-lite')).toBe(true);
    });

    it('parses codex model mode into family and effort', () => {
        expect(parseCodexModelMode('gpt-5.2-medium')).toEqual({
            family: 'gpt-5.2',
            effort: 'medium',
        });
        expect(parseCodexModelMode('claude-opus-4-6')).toEqual({
            family: MODEL_MODE_DEFAULT,
            effort: 'medium',
        });
    });

    it('builds codex model mode and default', () => {
        expect(buildCodexModelMode('gpt-5.4-mini', 'low')).toBe('gpt-5.4-mini-low');
        expect(buildCodexModelMode('gpt-5.4-mini', 'xhigh')).toBe('gpt-5.4-mini-xhigh');
        expect(buildCodexModelMode('gpt-5.6-sol', 'ultra')).toBe('gpt-5.6-sol-ultra');
        expect(buildCodexModelMode('gpt-5.6-luna', 'max')).toBe('gpt-5.6-luna-max');
        expect(buildCodexModelMode(MODEL_MODE_DEFAULT, 'high')).toBe(MODEL_MODE_DEFAULT);
    });

    it('returns valid reasoning options per codex family', () => {
        expect(getCodexReasoningOptions('gpt-5.4-mini')).toEqual(['xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-sol')).toEqual(['ultra', 'max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-terra')).toEqual(['ultra', 'max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-luna')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions(MODEL_MODE_DEFAULT)).toEqual(['high', 'medium', 'low']);
    });

    it('resolves session model selection payload for each flavor', () => {
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.2-high')).toEqual({
            model: 'gpt-5.2',
            reasoningEffort: 'high',
        });
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-4-5')).toEqual({
            model: 'claude-opus-4-5',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('gemini', 'gemini-2.5-flash-lite')).toEqual({
            model: 'gemini-2.5-flash-lite',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('codex', MODEL_MODE_DEFAULT)).toEqual({
            model: null,
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('codex', 'custom-model-id')).toEqual({
            model: 'custom-model-id',
            reasoningEffort: null,
        });
    });

    it('keeps codex model list in catalog shape', () => {
        expect(CODEX_MODEL_MODES[0]).toBe(MODEL_MODE_DEFAULT);
        expect(CODEX_MODEL_MODES).toContain('gpt-5.4-mini-high');
    });

    it('keeps gemini free-tier fallback model in catalog', () => {
        expect(GEMINI_MODEL_MODES[0]).toBe(MODEL_MODE_DEFAULT);
        expect(GEMINI_MODEL_MODES).toContain('gemini-2.5-flash-lite');
    });

    it('resolves context windows for claude composite and fast model modes', () => {
        expect(getMaxContextSize('claude-opus-4-8-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8[1m]-xhigh', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6-high', 'claude')).toBe(200_000);
        expect(getMaxContextSize('claude-opus-4-6-fast', 'claude')).toBe(200_000);
        expect(getMaxContextSize('claude-opus-4-6', 'claude')).toBe(200_000);
        // 1M context variants
        expect(getMaxContextSize('claude-opus-4-6[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6[1m]-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-sonnet-4-6[1m]', 'claude')).toBe(1_000_000);
    });

    it('resolves context window from actualModel when modelMode is default', () => {
        // Exact match
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6')).toBe(200_000);
        // SDK date-stamped model ID (prefix match)
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-20250514')).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-1-20250805')).toBe(200_000);
        // -fast suffix
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6-fast')).toBe(200_000);
        // Codex actual model
        expect(getMaxContextSize('default', 'codex', 'gpt-5.2')).toBe(272_000);
        expect(getMaxContextSize('default', 'codex', 'gpt-5.6-sol')).toBe(372_000);
        // Gemini actual model
        expect(getMaxContextSize('default', 'gemini', 'gemini-2.5-flash-lite')).toBe(1_000_000);
        // Unknown model falls back to agent default
        expect(getMaxContextSize('default', 'claude', 'some-unknown-model')).toBe(200_000);
        // No actualModel falls back to agent default
        expect(getMaxContextSize('default', 'claude')).toBe(200_000);
        expect(getMaxContextSize('default', 'gemini')).toBe(1_000_000);
    });

    it('infers a 1M window when actual context usage already exceeds the computed window', () => {
        // A 200K window can't hold >200K tokens — so the session must be on 1M,
        // even when modelMode is default and the reported model lacks [1m].
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-7', 250_000)).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', undefined, 300_000)).toBe(1_000_000);
        // Usage within the computed window leaves it unchanged.
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-7', 150_000)).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-7')).toBe(200_000);
        // Never shrinks an already-larger window.
        expect(getMaxContextSize('claude-opus-4-7[1m]', 'claude', undefined, 5_000)).toBe(1_000_000);
    });
});
