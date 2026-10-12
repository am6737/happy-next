import { findMentions, mentionIds, type MentionCandidate } from 'happy-wire';
import type { StoredChannelMessage } from './channelReducers';

/** The wire reply is just a label. Associate it with the newest unanswered matching decision. */
export function channelDecisionSelections(messages: StoredChannelMessage[]): Record<string, string> {
    const selections: Record<string, string> = {};
    const decisions: StoredChannelMessage[] = [];
    for (const message of messages) {
        if (message.kind === 'decision' && message.body?.options?.length) decisions.push(message);
        if (message.senderType !== 'user' || message.kind !== 'text' || !message.body || message.delivery === 'failed') continue;
        for (let i = decisions.length - 1; i >= 0; i--) {
            const decision = decisions[i];
            const option = decision.body?.options?.find(option => option.label === message.body?.text);
            if (selections[decision.id] || decision.taskId !== message.taskId || !option) continue;
            selections[decision.id] = option.id;
            break;
        }
    }
    return selections;
}
/** The Agents a message mentions by "@Name"; these ids are what the server wakes, the text is only display. */
export function channelMentions(text: string, members: MentionCandidate[]): string[] {
    return mentionIds(text, members);
}

/**
 * Turns each mention of a known member into a `mention:<teammateId>` markdown link, which MarkdownView renders as a link
 * that opens that Agent's profile. The link shows the member's current name, so renamed Agents and legacy handles read right.
 */
export function channelMentionLinks(text: string, members: MentionCandidate[]): string {
    let result = '';
    let last = 0;
    for (const { id, start, end } of findMentions(text, members)) {
        const name = members.find(member => member.id === id)!.name.replace(/[[\]\\]/g, '\\$&');
        result += `${text.slice(last, start)}[@${name}](mention:${encodeURIComponent(id)})`;
        last = end;
    }
    return result + text.slice(last);
}

/** Only the latest task decision drives the DM composer. Any successful task reply answers it. */
export function latestUnansweredTaskDecision(messages: StoredChannelMessage[]): StoredChannelMessage | null {
    const ordered = [...messages].sort((a, b) => {
        if (!!a.delivery !== !!b.delivery) return a.delivery ? 1 : -1;
        return a.seq - b.seq || a.createdAt - b.createdAt;
    });
    let index = -1;
    ordered.forEach((message, position) => { if (message.senderType === 'teammate' && message.kind === 'decision' && message.taskId) index = position; });
    if (index < 0) return null;
    const decision = ordered[index];
    const answered = ordered.slice(index + 1).some(message => message.senderType === 'user' && message.kind === 'text'
        && message.taskId === decision.taskId && message.delivery !== 'failed');
    return answered ? null : decision;
}
