import { isAskUserQuestionToolCall, isPreviewHtmlToolCall, type Message } from '@/sync/typesMessage';
import type { LandmarkRow } from './chatListVisibility';

/** Only the top-level messages the minimap can use; preserve identity during ordinary reply updates. */
export function selectChatLandmarkMessages(messages: readonly Message[], previous: Message[] = []): Message[] {
    let selected: Message[] | undefined;
    let count = 0;
    for (const message of messages) {
        if (message.kind !== 'user-text' && !isAskUserQuestionToolCall(message) && !isPreviewHtmlToolCall(message)) continue;
        if (!selected && previous[count] !== message) selected = previous.slice(0, count);
        if (selected) selected.push(message);
        count++;
    }
    return selected ?? (count === previous.length ? previous : previous.slice(0, count));
}

/** Body/permission changes do not change positions; avoid rebuilding a full Map on every token. */
export function buildChatKeyIndex(messages: readonly Message[], previous?: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
    if (previous?.size === messages.length && messages.every((message, index) => previous.get(message.id) === index)) {
        return previous;
    }
    const positions = new Map<string, number>();
    messages.forEach((message, index) => positions.set(message.id, index));
    return positions;
}

/** Derive rail positions from stable keys, without rescanning every message when only its body changes. */
export function buildChatLandmarkRows(positions: ReadonlyMap<string, number>, railIds: Iterable<string>): LandmarkRow[] {
    const rows: LandmarkRow[] = [];
    for (const id of new Set(railIds)) {
        const index = positions.get(id);
        if (index !== undefined) rows.push({ id, index });
    }
    return rows.sort((a, b) => a.index - b.index);
}
