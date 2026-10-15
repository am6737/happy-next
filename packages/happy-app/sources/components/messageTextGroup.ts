import type { Message } from '@/sync/typesMessage';
import { shouldHideMessageInChatList } from './chatListVisibility';

function isGroupText(message: Message): boolean {
    return message.kind === 'agent-text' && !message.isThinking;
}

/**
 * The text of the run of agent texts that ends at a message, oldest first and joined by a blank line.
 *
 * An agent reply arrives as one row per content block, so a reply the reader sees as one can be
 * several rows standing next to each other. Copying, reading aloud and long-press selection take the
 * message together with the texts right above it. Rows the list hides (thinking, when it is turned
 * off) are skipped, so two texts that look adjacent are adjacent; anything else on screen — a step,
 * thinking, a notice, a prompt — ends the run.
 *
 * So does the end of the turn before: a turn the agent starts on its own, with no prompt, can open
 * with a text right under the previous turn's answer (see `collectTurns`). That answer carries its own
 * action bar, and is the CLI's turn stamp (`meta.turn`) changing between the two rows.
 *
 * Only older rows join: the action bar sits on a turn's last text, so whatever stands below it is the
 * next turn's.
 *
 * Resolved when the reader acts rather than on every render, so a list that changes with each
 * streamed token pays nothing for it. `messages` is newest first, the order the store keeps them in.
 * Returns null when the message is not in `messages` or is not such a text.
 */
export function textGroupEndingAt(messages: readonly Message[], messageId: string, showThinkingMessages: boolean): string | null {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || !isGroupText(messages[index])) return null;

    const texts: string[] = [];
    // The turn of the newest stamped row so far; rows without a stamp (older CLIs) leave it as it is.
    let stampedTurn: string | undefined;
    for (let i = index; i < messages.length; i++) {
        const message = messages[i];
        if (shouldHideMessageInChatList(message, showThinkingMessages)) continue;
        if (!isGroupText(message)) break;
        const turn = message.meta?.turn;
        if (turn !== undefined && stampedTurn !== undefined && turn !== stampedTurn) break;
        stampedTurn = turn ?? stampedTurn;
        texts.push((message as { text: string }).text);
    }
    return texts.reverse().join('\n\n');
}
