import type { StoredChannelMessage } from './channelReducers';

/** The wire reply is just a label. Associate it with the newest unanswered matching decision. */
export function channelDecisionSelections(messages: StoredChannelMessage[]): Record<string, string> {
    const selections: Record<string, string> = {};
    const decisions: StoredChannelMessage[] = [];
    for (const message of messages) {
        if (message.kind === 'decision' && message.body?.options?.length) decisions.push(message);
        if (message.senderType !== 'user' || message.kind !== 'text' || !message.body || message.delivery === 'failed') continue;
        const decision = [...decisions].reverse().find(m => !selections[m.id] && m.taskId === message.taskId && m.body?.options?.some(option => option.label === message.body?.text));
        const option = decision?.body?.options?.find(option => option.label === message.body?.text);
        if (decision && option) selections[decision.id] = option.id;
    }
    return selections;
}
export function channelMentions(text: string, members: Array<{ id: string; handle: string }>): string[] {
    const handles = new Set([...text.matchAll(/(?:^|[^\p{L}\p{N}_@-])@([a-z0-9][a-z0-9_-]{1,31})(?![\p{L}\p{N}_-])/gu)].map(match => match[1]));
    return members.filter(m => handles.has(m.handle)).map(m => m.id);
}

/** Turns each @handle of a known member into a `mention:<teammateId>` markdown link, which MarkdownView renders as a link that opens that Agent's profile. */
export function channelMentionLinks(text: string, members: Array<{ id: string; handle: string }>): string {
    if (members.length === 0) return text;
    const byHandle = new Map(members.map(m => [m.handle, m.id]));
    return text.replace(/(^|[^\p{L}\p{N}_@-])@([a-z0-9][a-z0-9_-]{1,31})(?![\p{L}\p{N}_-])/gu,
        (match, lead: string, handle: string) => byHandle.has(handle) ? `${lead}[@${handle}](mention:${encodeURIComponent(byHandle.get(handle)!)})` : match);
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
