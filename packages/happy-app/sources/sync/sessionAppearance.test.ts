import { describe, expect, it } from 'vitest';
import {
    applySessionAppearancePatch,
    createEmptySessionAppearance,
    decodeSessionAppearanceValue,
    encodeSessionAppearanceValue,
    normalizeSessionAppearance,
} from './sessionAppearance';

describe('sessionAppearance', () => {
    it('sets, replaces, and clears a session marker', () => {
        const initial = createEmptySessionAppearance(1);
        const red = applySessionAppearancePatch(initial, { sessionId: 's1', color: 'red', updatedAt: 2 });
        const blue = applySessionAppearancePatch(red, { sessionId: 's1', color: 'blue', updatedAt: 3 });
        const cleared = applySessionAppearancePatch(blue, { sessionId: 's1', color: null, updatedAt: 4 });

        expect(red.sessions.s1?.color).toBe('red');
        expect(blue.sessions.s1).toEqual({ color: 'blue', updatedAt: 3 });
        expect(cleared.sessions.s1).toBeUndefined();
    });

    it('drops invalid entries while normalizing', () => {
        const normalized = normalizeSessionAppearance({
            updatedAt: 10,
            sessions: {
                valid: { color: 'purple', updatedAt: 9 },
                invalid: { color: 'pink', updatedAt: 8 },
            },
        });

        expect(normalized.sessions).toEqual({ valid: { color: 'purple', updatedAt: 9 } });
    });

    it('round-trips through base64 encoding', () => {
        const original = applySessionAppearancePatch(
            createEmptySessionAppearance(10),
            { sessionId: 'session-1', color: 'green', updatedAt: 11 },
        );

        expect(decodeSessionAppearanceValue(encodeSessionAppearanceValue(original))).toEqual(original);
    });

    it('falls back to an empty document for corrupt values', () => {
        expect(decodeSessionAppearanceValue('not-base64').sessions).toEqual({});
    });
});
