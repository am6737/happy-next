/**
 * What a resumed or copied session shows of its history: the prompts the user sent and the reply
 * each one ended on, for the last few turns. The tool calls and working-out between them are left
 * out — they made a copy upload and the app decrypt megabytes for rows nobody reads there — and the
 * agent loses nothing by it, since it resumes its own transcript in full.
 */

import { randomUUID } from 'node:crypto';

/** A history entry's part in a turn: the prompt that opens it, a reply, or neither. */
export type BackfillRole = 'prompt' | 'reply' | null;

/**
 * The last `maxTurns` turns of `items`, each as its prompt followed by its last reply, and how many
 * turns before them were left out. A turn runs from one prompt to the next, so when the agent spoke
 * again after an injected prompt — reporting a finished run — that report is the turn's last reply.
 */
export function selectBackfillTurns<T>(items: readonly T[], roleOf: (item: T) => BackfillRole, maxTurns: number): { selected: T[]; omittedTurns: number } {
    const turns: { prompt: T; reply: T | null }[] = [];
    for (const item of items) {
        const role = roleOf(item);
        if (role === 'prompt') {
            turns.push({ prompt: item, reply: null });
        } else if (role === 'reply' && turns.length > 0) {
            turns[turns.length - 1].reply = item;
        }
    }
    const kept = turns.slice(-maxTurns);
    return {
        selected: kept.flatMap((turn) => turn.reply === null ? [turn.prompt] : [turn.prompt, turn.reply]),
        omittedTurns: turns.length - kept.length,
    };
}

type BackfillNotice = { content: unknown; localId: string };

function forkedHistoryEvent(localId: string, data: Record<string, unknown>): BackfillNotice {
    return {
        localId,
        content: {
            role: 'agent',
            content: { id: randomUUID(), type: 'event', data: { type: 'forked-history', ...data } },
            meta: { sentFrom: 'cli' },
        },
    };
}

/**
 * A backfill's messages between its two notices: above them how many earlier turns it leaves out,
 * below them the session they came from (the app passes it when it copies, resumes or upgrades one;
 * from an agent's own history list only its title), so that one sits where the copied history ends
 * and the new conversation begins. Each notice only when it has something to say.
 * `localIdPrefix` is the backfill's own, so a backfill that runs again replaces them with its own.
 */
export function withForkedHistoryNotices<T>(localIdPrefix: string, omittedTurns: number, messages: readonly T[]): (T | BackfillNotice)[] {
    const sourceSessionId = process.env.HAPPY_FORKED_FROM_SESSION_ID?.trim();
    const sourceTitle = process.env.HAPPY_FORKED_FROM_TITLE?.trim();
    return [
        ...(omittedTurns > 0 ? [forkedHistoryEvent(`${localIdPrefix}forked-history`, { omittedTurns })] : []),
        ...messages,
        ...(sourceSessionId || sourceTitle
            ? [forkedHistoryEvent(`${localIdPrefix}forked-from`, {
                omittedTurns: 0,
                ...(sourceSessionId ? { sourceSessionId } : {}),
                ...(sourceTitle ? { sourceTitle } : {}),
            })]
            : []),
    ];
}
