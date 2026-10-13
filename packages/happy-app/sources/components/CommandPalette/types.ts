import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

export interface Command {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
    shortcut?: string;
    category?: string;
    categoryOrder?: number;
    keywords?: string[];
    priority?: number;
    showWhenIdle?: boolean;
    // Fixed entry shown as a grid tile while the query is empty
    tile?: boolean;
    // Category to group under while the query is empty, when it differs from `category`
    idleCategory?: string;
    badge?: string;
    // Last activity, shown as relative time at the row's trailing edge
    timestamp?: number;
    badgeTone?: 'neutral' | 'success' | 'warning' | 'accent';
    dangerous?: boolean;
    sessionId?: string;
    // Rows of a session's message hits: the session heading, one hit beneath it, or the "N more" expander
    layout?: 'messageGroup' | 'messageHit' | 'messageMore';
    // Who wrote a `messageHit` row's message, shown ahead of its snippet
    author?: string;
    // Runs without closing the palette (expanding a group in place)
    keepOpen?: boolean;
    action: () => void | Promise<void>;
}

export interface CommandCategory {
    id: string;
    title: string;
    order: number;
    commands: Command[];
}

/**
 * Searches messages for `query`, handing over the merged hits each time another source (the local
 * cache, a machine) answers, and resolving once all of them have.
 */
export type MessageSearch = (query: string, onMatches: (matches: CachedMessageSearchMatch[]) => void) => Promise<void>;
