import { Message, MinimapMessage } from '@/sync/typesMessage';

const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/;

// Claude Code emits a text-only companion for every image attachment. The image itself rides in
// the `mixed` message that carries the prompt the user actually typed, so this companion is noise.
const IMAGE_PLACEHOLDER_PATTERN = /^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]$/;

function isCompactionMarkerText(text: string): boolean {
    return LOCAL_COMMAND_STDOUT_PATTERN.test(text.trim());
}

function isImagePlaceholderText(text: string): boolean {
    return IMAGE_PLACEHOLDER_PATTERN.test(text.trim());
}

// Rows hidden here are dropped from the list entirely rather than rendered as null. Both lists
// size rows from measured heights (the web one from a persisted height model), so a row whose
// content collapses but whose element survives keeps the height it was once given — the gap this
// guard exists to prevent. Shared by ChatList.tsx and ChatList.web.tsx.
export function shouldHideMessageInChatList(message: Message, showThinkingMessages: boolean): boolean {
    if (message.kind === 'agent-text' && message.isThinking && !showThinkingMessages) {
        return true;
    }
    if (message.kind !== 'user-text') {
        return false;
    }
    // Never hide a message that actually carries images — only the text companion is noise.
    if (message.images?.length) {
        return false;
    }
    const text = message.displayText ?? message.text;
    return isCompactionMarkerText(text) || isImagePlaceholderText(text);
}

/**
 * Whether the conversation minimap should leave this landmark off its rail.
 *
 * The rail only ever points at rows the list actually renders — a marker for a row the list hides
 * would jump nowhere — so everything `shouldHideMessageInChatList` drops is dropped here too. On
 * top of that the minimap hides post-compaction summaries: the list keeps them (they are the only
 * record of what was dropped), but they are not a landmark the user wrote, and a summary can be
 * thousands of words of prose that would swamp every real prompt around it on the rail.
 *
 * `meta.isCompactSummary` is the structural signal — Claude Code stamps it on the summary record
 * itself and the CLI forwards it — so this never has to pattern-match the summary's wording.
 */
export function shouldHideMessageInMinimap(message: MinimapMessage): boolean {
    if (message.kind === 'ask-user-question') {
        return false;
    }
    if (message.meta?.isCompactSummary === true) {
        return true;
    }
    // Thinking rows are never user rows, so the setting cannot matter here.
    return shouldHideMessageInChatList(message, true);
}
