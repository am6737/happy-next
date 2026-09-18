import { describe, expect, it } from 'vitest';
import {
    askUserQuestionDraftKey,
    isSameAskUserQuestionDraft,
    normalizeAskUserQuestionDraft,
    parseAskUserQuestionDrafts,
    pruneAskUserQuestionDrafts,
    writeAskUserQuestionDraft,
    type AskUserQuestionDraftMap,
} from './askUserQuestionDraft';

const NOW = 1_700_000_000_000;

function draft(overrides: Partial<Parameters<typeof normalizeAskUserQuestionDraft>[0] & object> = {}) {
    return {
        selections: {},
        otherTexts: {},
        updatedAt: NOW,
        ...overrides,
    };
}

describe('askUserQuestionDraftKey', () => {
    it('files a draft under the permission id, which is the CLI tool id', () => {
        expect(askUserQuestionDraftKey({ permission: { id: 'tool-1' }, callId: 'tool-1' })).toBe('tool-1');
    });

    it('falls back to the tool call id once the call is running', () => {
        expect(askUserQuestionDraftKey({ callId: 'tool-2' })).toBe('tool-2');
    });

    it('prefers the permission id when the two disagree (Gemini)', () => {
        expect(askUserQuestionDraftKey({ permission: { id: 'perm-1' }, callId: 'call-1' })).toBe('perm-1');
    });

    it('has no key without either id, so nothing is drafted for a call that cannot be answered', () => {
        expect(askUserQuestionDraftKey({})).toBeNull();
        expect(askUserQuestionDraftKey(null)).toBeNull();
    });
});

describe('normalizeAskUserQuestionDraft', () => {
    it('collapses an untouched question to no draft', () => {
        expect(normalizeAskUserQuestionDraft(null)).toBeNull();
        expect(normalizeAskUserQuestionDraft(draft())).toBeNull();
    });

    it('collapses whitespace-only text to no draft', () => {
        expect(normalizeAskUserQuestionDraft(draft({ otherTexts: { 0: '   ' } }))).toBeNull();
    });

    it('drops empty selections and blank text but keeps the rest', () => {
        const normalized = normalizeAskUserQuestionDraft(draft({
            selections: { 0: [1], 1: [] },
            otherTexts: { 0: 'typed', 1: '  ' },
        }));
        expect(normalized).toEqual({
            selections: { 0: [1] },
            otherTexts: { 0: 'typed' },
            updatedAt: NOW,
        });
    });

    it('keeps a submitted draft even with nothing in it', () => {
        expect(normalizeAskUserQuestionDraft(draft({ submitted: true }))?.submitted).toBe(true);
    });
});

describe('isSameAskUserQuestionDraft', () => {
    it('ignores updatedAt so a re-flush of an untouched draft stays a no-op', () => {
        const a = normalizeAskUserQuestionDraft(draft({ selections: { 0: [1] } }))!;
        const b = normalizeAskUserQuestionDraft(draft({ selections: { 0: [1] }, updatedAt: NOW + 5_000 }))!;
        expect(isSameAskUserQuestionDraft(a, b)).toBe(true);
    });

    it('compares option indices order-insensitively', () => {
        const a = normalizeAskUserQuestionDraft(draft({ selections: { 0: [1, 2] } }))!;
        const b = normalizeAskUserQuestionDraft(draft({ selections: { 0: [2, 1] } }))!;
        expect(isSameAskUserQuestionDraft(a, b)).toBe(true);
    });

    it('tells drafts apart on text, ticks and the submitted flag', () => {
        const base = normalizeAskUserQuestionDraft(draft({ selections: { 0: [1] } }))!;
        expect(isSameAskUserQuestionDraft(base, normalizeAskUserQuestionDraft(draft({ selections: { 0: [2] } }))!)).toBe(false);
        expect(isSameAskUserQuestionDraft(base, normalizeAskUserQuestionDraft(draft({ selections: { 0: [1], 1: [0] } }))!)).toBe(false);
        expect(isSameAskUserQuestionDraft(base, normalizeAskUserQuestionDraft(draft({ otherTexts: { 0: 'x' } }))!)).toBe(false);
        expect(isSameAskUserQuestionDraft(base, normalizeAskUserQuestionDraft(draft({ selections: { 0: [1] }, submitted: true }))!)).toBe(false);
    });
});

describe('writeAskUserQuestionDraft', () => {
    it('files a draft under session and tool key', () => {
        const map = writeAskUserQuestionDraft({}, 'session-1', 'tool-1', draft({ selections: { 0: [1] } }));
        expect(map['session-1']['tool-1'].selections).toEqual({ 0: [1] });
    });

    it('returns the same map when nothing changed, so the store can skip the write', () => {
        const map = writeAskUserQuestionDraft({}, 'session-1', 'tool-1', draft({ selections: { 0: [1] } }));
        const again = writeAskUserQuestionDraft(map, 'session-1', 'tool-1', draft({ selections: { 0: [1] }, updatedAt: NOW + 1 }));
        expect(again).toBe(map);
    });

    it('clears an entry and drops the empty session bucket', () => {
        const map = writeAskUserQuestionDraft({}, 'session-1', 'tool-1', draft({ selections: { 0: [1] } }));
        const cleared = writeAskUserQuestionDraft(map, 'session-1', 'tool-1', null);
        expect(cleared).toEqual({});
        expect(cleared).not.toBe(map);
    });

    it('is a no-op when clearing something that was never drafted', () => {
        const map: AskUserQuestionDraftMap = {};
        expect(writeAskUserQuestionDraft(map, 'session-1', 'tool-1', null)).toBe(map);
    });

    it('keeps sessions and tools apart', () => {
        let map = writeAskUserQuestionDraft({}, 'session-1', 'tool-1', draft({ selections: { 0: [1] } }));
        map = writeAskUserQuestionDraft(map, 'session-1', 'tool-2', draft({ selections: { 0: [2] } }));
        map = writeAskUserQuestionDraft(map, 'session-2', 'tool-1', draft({ selections: { 0: [3] } }));
        expect(map['session-1']['tool-1'].selections).toEqual({ 0: [1] });
        expect(map['session-1']['tool-2'].selections).toEqual({ 0: [2] });
        expect(map['session-2']['tool-1'].selections).toEqual({ 0: [3] });
    });

    it('ignores a write with no session or no tool key', () => {
        const map: AskUserQuestionDraftMap = {};
        expect(writeAskUserQuestionDraft(map, null, 'tool-1', draft({ selections: { 0: [1] } }))).toBe(map);
        expect(writeAskUserQuestionDraft(map, 'session-1', null, draft({ selections: { 0: [1] } }))).toBe(map);
    });
});

describe('pruneAskUserQuestionDrafts', () => {
    const maxAge = 7 * 24 * 60 * 60 * 1000;

    it('drops entries older than the window and keeps fresh ones', () => {
        const map = writeAskUserQuestionDraft({}, 'session-1', 'stale', draft({ selections: { 0: [1] }, updatedAt: NOW - maxAge - 1 }));
        const withFresh = writeAskUserQuestionDraft(map, 'session-1', 'fresh', draft({ selections: { 0: [2] } }));
        expect(pruneAskUserQuestionDrafts(withFresh, NOW, maxAge)).toEqual({
            'session-1': { fresh: { selections: { 0: [2] }, otherTexts: {}, updatedAt: NOW } },
        });
    });

    it('returns the same map when nothing expired', () => {
        const map = writeAskUserQuestionDraft({}, 'session-1', 'tool-1', draft({ selections: { 0: [1] } }));
        expect(pruneAskUserQuestionDrafts(map, NOW, maxAge)).toBe(map);
    });
});

describe('parseAskUserQuestionDrafts', () => {
    it('round-trips through JSON, where numeric keys become strings', () => {
        const map = writeAskUserQuestionDraft(
            {},
            'session-1',
            'tool-1',
            draft({ selections: { 0: [1, 3] }, otherTexts: { 1: 'typed' }, submitted: true })
        );
        const parsed = parseAskUserQuestionDrafts(JSON.parse(JSON.stringify(map)));
        expect(parsed['session-1']['tool-1']).toEqual({
            selections: { 0: [1, 3] },
            otherTexts: { 1: 'typed' },
            submitted: true,
            updatedAt: NOW,
        });
    });

    it('discards anything that is not a usable draft', () => {
        expect(parseAskUserQuestionDrafts(null)).toEqual({});
        expect(parseAskUserQuestionDrafts('nonsense')).toEqual({});
        expect(parseAskUserQuestionDrafts({ 'session-1': 'nonsense' })).toEqual({});
        expect(parseAskUserQuestionDrafts({ 'session-1': { 'tool-1': { selections: { 0: [] }, otherTexts: {} } } })).toEqual({});
        expect(parseAskUserQuestionDrafts({ 'session-1': { 'tool-1': { selections: 'nope', otherTexts: 5 } } })).toEqual({});
    });
});
