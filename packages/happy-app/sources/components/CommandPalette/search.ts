import type { Command, CommandCategory } from './types';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';
import { requestSessionMessageJump } from '@/sync/sessionMessageJump';

const SEARCH_RESULT_LIMIT = 60;

// Fixed entries render as a grid only while the query is empty; search results are always a ranked list
export function isTileCategory(category: CommandCategory, rawQuery: string): boolean {
    return !rawQuery.trim() && category.commands.length > 0 && category.commands.every((command) => command.tile);
}

// Rows of flattened command indices, used for arrow-key movement across tiles and list rows alike
export function buildNavigationRows(categories: CommandCategory[], rawQuery: string, columns: number): number[][] {
    const rows: number[][] = [];
    let index = 0;
    for (const category of categories) {
        const indices = category.commands.map(() => index++);
        if (isTileCategory(category, rawQuery)) {
            for (let start = 0; start < indices.length; start += columns) {
                rows.push(indices.slice(start, start + columns));
            }
        } else {
            rows.push(...indices.map((i) => [i]));
        }
    }
    return rows;
}

export function normalizeCommandSearchText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[\\/_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function fuzzySubsequenceScore(value: string, query: string): number {
    let queryIndex = 0;
    let firstMatch = -1;
    let previousMatch = -1;
    let gapPenalty = 0;

    for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex++) {
        if (value[valueIndex] !== query[queryIndex]) continue;
        if (firstMatch === -1) firstMatch = valueIndex;
        if (previousMatch !== -1) gapPenalty += valueIndex - previousMatch - 1;
        previousMatch = valueIndex;
        queryIndex++;
    }

    if (queryIndex !== query.length) return 0;
    return Math.max(20, 180 - firstMatch * 3 - gapPenalty * 4);
}

function fieldScore(value: string, query: string, weight: number): number {
    if (!value) return 0;
    if (value === query) return weight + 400;
    if (value.startsWith(query)) return weight + 280;
    if (value.split(' ').some((word) => word.startsWith(query))) return weight + 210;
    if (value.includes(query)) return weight + 140;
    const fuzzy = fuzzySubsequenceScore(value, query);
    return fuzzy > 0 ? weight + fuzzy : 0;
}

export function scoreCommand(command: Command, rawQuery: string): number {
    const query = normalizeCommandSearchText(rawQuery);
    if (!query) return command.priority ?? 0;

    const tokens = query.split(' ').filter(Boolean);
    const title = normalizeCommandSearchText(command.title);
    const subtitle = normalizeCommandSearchText(command.subtitle ?? '');
    const keywords = (command.keywords ?? []).map(normalizeCommandSearchText);

    let total = 0;
    for (const token of tokens) {
        const titleScore = fieldScore(title, token, 600);
        const subtitleScore = fieldScore(subtitle, token, 260);
        const keywordScore = keywords.reduce(
            (best, keyword) => Math.max(best, fieldScore(keyword, token, 400)),
            0,
        );
        const tokenScore = Math.max(titleScore, subtitleScore, keywordScore);
        if (tokenScore === 0) return 0;
        total += tokenScore;
    }

    return total + (command.priority ?? 0);
}

// Hits a session shows before the rest fold into a "N more" row
const COLLAPSED_HIT_COUNT = 3;

export type MessageCategoryLabels = {
    category: string;
    badge: string;
    user: string;
    agent: string;
    more: (count: number) => string;
};

// Cached message hits grouped by session: a lone hit merges with its session into one row, while
// several sit under a session heading, the extras folded behind a row that expands them in place
export function buildMessageCategory(
    commands: Command[],
    matches: CachedMessageSearchMatch[],
    labels: MessageCategoryLabels,
    expandedSessionIds: ReadonlySet<string>,
    onExpand: (sessionId: string) => void,
): CommandCategory | null {
    const sessionCommands = new Map(
        commands.filter((command) => command.sessionId).map((command) => [command.sessionId!, command]),
    );
    const bySession = new Map<string, CachedMessageSearchMatch[]>();
    for (const match of matches) {
        if (!sessionCommands.has(match.sessionId)) continue;
        bySession.set(match.sessionId, [...(bySession.get(match.sessionId) ?? []), match]);
    }

    const openAt = (session: Command, match: CachedMessageSearchMatch) => () => {
        requestSessionMessageJump(match.sessionId, { id: match.messageId, seq: match.seq });
        return session.action();
    };
    const author = (match: CachedMessageSearchMatch) => match.role === 'user' ? labels.user : labels.agent;

    const rows: Command[] = [];
    for (const [sessionId, hits] of bySession) {
        const session = sessionCommands.get(sessionId)!;
        if (hits.length === 1) {
            const [match] = hits;
            rows.push({
                ...session,
                id: `message-${sessionId}-${match.messageId}`,
                subtitle: `${author(match)}: ${match.snippet}`,
                timestamp: match.createdAt,
                badge: labels.badge,
                badgeTone: 'accent',
                action: openAt(session, match),
            });
            continue;
        }

        rows.push({
            ...session,
            id: `message-group-${sessionId}`,
            subtitle: undefined,
            timestamp: undefined,
            badge: String(hits.length),
            badgeTone: 'accent',
            layout: 'messageGroup',
        });
        const visible = expandedSessionIds.has(sessionId) ? hits : hits.slice(0, COLLAPSED_HIT_COUNT);
        for (const match of visible) {
            rows.push({
                id: `message-${sessionId}-${match.messageId}`,
                sessionId,
                title: match.snippet,
                author: author(match),
                timestamp: match.createdAt,
                layout: 'messageHit',
                action: openAt(session, match),
            });
        }
        if (visible.length < hits.length) {
            rows.push({
                id: `message-more-${sessionId}`,
                sessionId,
                title: labels.more(hits.length - visible.length),
                layout: 'messageMore',
                keepOpen: true,
                action: () => onExpand(sessionId),
            });
        }
    }

    return rows.length > 0 ? { id: 'messages', title: labels.category, order: 0, commands: rows } : null;
}

// `messageCategory` holds the cached message hits; their sessions' own rows give way to it, and it
// ranks as a keyword hit on every query token would, so a strong title match can still lead
export function groupCommands(commands: Command[], rawQuery: string, messageCategory?: CommandCategory | null): CommandCategory[] {
    const query = normalizeCommandSearchText(rawQuery);
    if (query && messageCategory) {
        const hitSessionIds = new Set(messageCategory.commands.map((command) => command.sessionId));
        commands = commands.filter((command) => !command.sessionId || !hitSessionIds.has(command.sessionId));
    }
    const ranked = commands
        .filter((command) => query ? true : command.showWhenIdle !== false)
        .map((command) => ({ command, score: scoreCommand(command, query) }))
        .filter(({ score }) => !query || score > 0)
        .sort((a, b) => {
            if (query && b.score !== a.score) return b.score - a.score;
            const categoryOrder = (a.command.categoryOrder ?? 100) - (b.command.categoryOrder ?? 100);
            if (categoryOrder !== 0) return categoryOrder;
            const priority = (b.command.priority ?? 0) - (a.command.priority ?? 0);
            if (priority !== 0) return priority;
            return a.command.title.localeCompare(b.command.title);
        })
        .slice(0, SEARCH_RESULT_LIMIT);

    const grouped = new Map<string, { category: CommandCategory; bestScore: number }>();
    for (const { command, score } of ranked) {
        const title = (query ? command.category : command.idleCategory ?? command.category) || 'General';
        const id = normalizeCommandSearchText(title).replace(/\s+/g, '-') || 'general';
        const existing = grouped.get(title);
        if (existing) {
            existing.category.commands.push(command);
            existing.bestScore = Math.max(existing.bestScore, score);
        } else {
            grouped.set(title, {
                category: {
                    id,
                    title,
                    order: command.categoryOrder ?? 100,
                    commands: [command],
                },
                bestScore: score,
            });
        }
    }

    const groups = [...grouped.values()];
    if (query && messageCategory) {
        groups.push({ category: messageCategory, bestScore: query.split(' ').filter(Boolean).length * 800 + 200 });
    }
    return groups
        .sort((a, b) => query ? b.bestScore - a.bestScore : a.category.order - b.category.order)
        .map(({ category }) => category);
}
