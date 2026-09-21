import type { MessageMeta } from '@/sync/typesMessageMeta';

/**
 * Beyond this many characters, parseMarkdown + the resulting React tree freezes the UI on
 * mid-range devices. Such messages are almost always pasted dumps (skill bodies, logs, files),
 * so we collapse them to a single tap-to-view placeholder instead of rendering them inline.
 */
export const LONG_USER_MESSAGE_THRESHOLD = 20000;

/** Why a user row renders as one tap-to-view line instead of its Markdown. */
export type CollapsedTextReason = 'compaction' | 'too-long';

/** How a user message's text should be rendered in the list. */
export type UserTextPresentation =
    | { kind: 'markdown' }
    | { kind: 'collapsed'; reason: CollapsedTextReason; chars: number };

/**
 * Whether a user row shows its Markdown inline or collapses to a tap-to-view line.
 *
 * A post-compaction summary collapses unconditionally, however short it is. It is a machine record
 * of what the context window dropped rather than something anyone typed, and inline it is thousands
 * of words of prose that push the real conversation off the screen — neither of which depends on how
 * long it happens to be, so unlike the too-long rule it has no threshold to clear.
 *
 * `renderedText` is what the row would render, i.e. `displayText || text`.
 */
export function userTextPresentation(renderedText: string, meta?: MessageMeta): UserTextPresentation {
    const chars = renderedText.length;
    if (meta?.isCompactSummary === true) {
        return { kind: 'collapsed', reason: 'compaction', chars };
    }
    if (chars > LONG_USER_MESSAGE_THRESHOLD) {
        return { kind: 'collapsed', reason: 'too-long', chars };
    }
    return { kind: 'markdown' };
}
