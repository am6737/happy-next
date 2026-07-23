import type { Command, CommandCategory } from './types';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

const SEARCH_RESULT_LIMIT = 60;

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

export function applyCachedMessageMatches(
    commands: Command[],
    matches: CachedMessageSearchMatch[],
    query: string,
    messageBadge: string,
): Command[] {
    if (matches.length === 0) return commands;
    const bySessionId = new Map(matches.map((match) => [match.sessionId, match]));
    return commands.map((command) => {
        if (!command.sessionId) return command;
        const match = bySessionId.get(command.sessionId);
        if (!match) return command;
        return {
            ...command,
            subtitle: `“${match.snippet}”`,
            keywords: [...(command.keywords ?? []), query],
            priority: (command.priority ?? 0) + 200,
            badge: command.badge ?? messageBadge,
            badgeTone: command.badgeTone ?? 'accent',
        };
    });
}

export function groupCommands(commands: Command[], rawQuery: string): CommandCategory[] {
    const query = normalizeCommandSearchText(rawQuery);
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
        const title = command.category || 'General';
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

    return [...grouped.values()]
        .sort((a, b) => query ? b.bestScore - a.bestScore : a.category.order - b.category.order)
        .map(({ category }) => category);
}
