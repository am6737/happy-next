import { MMKV } from 'react-native-mmkv';

// Local only — queries can contain message text, so they never leave the device
const mmkv = new MMKV();
const SEARCH_HISTORY_KEY = 'command-palette-search-history';

export const SEARCH_HISTORY_LIMIT = 20;

export function loadSearchHistory(): string[] {
    try {
        const parsed = JSON.parse(mmkv.getString(SEARCH_HISTORY_KEY) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
        return [];
    }
}

export function saveSearchHistory(history: string[]): void {
    if (history.length === 0) {
        mmkv.delete(SEARCH_HISTORY_KEY);
    } else {
        mmkv.set(SEARCH_HISTORY_KEY, JSON.stringify(history));
    }
}

// Newest first. A repeat moves to the top, and a query that extends the latest one ("dep" → "deploy") replaces it
export function addSearchHistoryEntry(history: string[], rawQuery: string): string[] {
    const query = rawQuery.trim();
    if (!query) return history;
    const normalized = query.toLowerCase();
    const latest = history[0]?.toLowerCase();
    const rest = history.filter((entry, index) => {
        const entryNormalized = entry.toLowerCase();
        if (entryNormalized === normalized) return false;
        return !(index === 0 && latest && normalized.startsWith(latest));
    });
    return [query, ...rest].slice(0, SEARCH_HISTORY_LIMIT);
}
