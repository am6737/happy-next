import { userPromptText } from 'happy-wire';

export interface SessionUserMessage {
    uuid: string;
    content: string;
    timestamp?: string;
    index: number;
}

export interface SessionUserMessagePage<T extends SessionUserMessage = SessionUserMessage> {
    messages: T[];
    hasMore: boolean;
    nextBeforeIndex: number | null;
}

const PREVIEW_LENGTH = 500;

export function toSessionUserMessagePreview<T extends SessionUserMessage>(message: T): T {
    if (message.content.length <= PREVIEW_LENGTH) return message;
    return {
        ...message,
        content: `${message.content.substring(0, PREVIEW_LENGTH)}...`,
    };
}

export function paginateSessionUserMessages<T extends SessionUserMessage>(
    messages: T[],
    limit: number,
    beforeIndex?: number,
    preview: boolean = true,
): SessionUserMessagePage<T> {
    const eligible = beforeIndex == null
        ? messages
        : messages.filter((message) => message.index < beforeIndex);
    const selected = eligible.slice(-limit);
    const page = preview ? selected.map(toSessionUserMessagePreview) : selected;
    const hasMore = eligible.length > page.length;
    return {
        messages: page,
        hasMore,
        nextBeforeIndex: hasMore && page.length > 0 ? page[0].index : null,
    };
}

/**
 * The message a chat row shows. The row holds the text as it reached the app — a slash command as
 * Claude Code's markup, a prompt sent from the terminal with its attached-files block — so it is
 * read by the same rule as the messages.
 */
export function resolveSessionUserMessage<T extends SessionUserMessage>(
    messages: T[],
    target: { text: string; createdAt?: number },
): T | null {
    const text = userPromptText(target.text) ?? target.text;
    if (!text) return null;
    const matches = messages.filter((message) => message.content === text);
    if (matches.length === 0) return null;
    if (matches.length === 1 || target.createdAt == null) return matches[0];

    let best = matches[0];
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const message of matches) {
        const timestamp = message.timestamp ? Date.parse(message.timestamp) : NaN;
        const delta = Number.isNaN(timestamp)
            ? Number.POSITIVE_INFINITY
            : Math.abs(timestamp - target.createdAt);
        if (delta < bestDelta) {
            best = message;
            bestDelta = delta;
        }
    }
    return best;
}
