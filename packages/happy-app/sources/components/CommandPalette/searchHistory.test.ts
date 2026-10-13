import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, string>();

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) {
            return values.get(key);
        }

        set(key: string, value: string) {
            values.set(key, value);
        }

        delete(key: string) {
            values.delete(key);
        }
    },
}));

import { addSearchHistoryEntry, loadSearchHistory, saveSearchHistory, SEARCH_HISTORY_LIMIT } from './searchHistory';

describe('addSearchHistoryEntry', () => {
    it('puts new queries first and ignores blank ones', () => {
        expect(addSearchHistoryEntry(['deploy'], '  token  ')).toEqual(['token', 'deploy']);
        expect(addSearchHistoryEntry(['deploy'], 'a')).toEqual(['a', 'deploy']);
        expect(addSearchHistoryEntry(['deploy'], '   ')).toEqual(['deploy']);
    });

    it('moves a repeated query to the top, ignoring case', () => {
        expect(addSearchHistoryEntry(['token', 'Deploy', 'mac'], 'deploy')).toEqual(['deploy', 'token', 'mac']);
    });

    it('replaces the latest query when the new one extends it', () => {
        expect(addSearchHistoryEntry(['dep', 'token'], 'deploy')).toEqual(['deploy', 'token']);
        // Only the latest entry is merged; older prefixes stay
        expect(addSearchHistoryEntry(['token', 'dep'], 'deploy')).toEqual(['deploy', 'token', 'dep']);
    });

    it('keeps at most the limit', () => {
        const full = Array.from({ length: SEARCH_HISTORY_LIMIT }, (_, index) => `query ${index}`);
        const next = addSearchHistoryEntry(full, 'newest');
        expect(next).toHaveLength(SEARCH_HISTORY_LIMIT);
        expect(next[0]).toBe('newest');
        expect(next).not.toContain(`query ${SEARCH_HISTORY_LIMIT - 1}`);
    });
});

describe('search history storage', () => {
    beforeEach(() => values.clear());

    it('round-trips and clears', () => {
        saveSearchHistory(['deploy', 'token']);
        expect(loadSearchHistory()).toEqual(['deploy', 'token']);
        saveSearchHistory([]);
        expect(loadSearchHistory()).toEqual([]);
    });

    it('ignores corrupt data', () => {
        values.set('command-palette-search-history', '{not json');
        expect(loadSearchHistory()).toEqual([]);
        values.set('command-palette-search-history', JSON.stringify(['ok', 3]));
        expect(loadSearchHistory()).toEqual(['ok']);
    });
});
