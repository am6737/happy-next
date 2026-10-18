// The kind a record goes to the server with, in the clear beside its ciphertext, so a reader that
// wants only the conversation (the watch) can ask for it without downloading every tool call.

export type MessageKind = 'text' | 'other';

/**
 * `text` for a record that may carry words the user or the agent wrote, `other` for the rest: tool
 * calls and their results, thinking, subagent traffic, events. Generous on purpose — a record put
 * under `text` that shows nothing costs a reader a few bytes, one put under `other` that shows
 * something is lost to it — so readers still sort what they get themselves.
 */
export function messageKind(record: unknown): MessageKind {
    const message = record as { role?: unknown; content?: any } | null;
    if (!message || typeof message !== 'object') return 'other';
    if (message.role === 'user') return 'text';
    if (message.role === 'session') return envelopeHasText(message.content?.data) ? 'text' : 'other';
    if (message.role !== 'agent') return 'other';

    const { type, data } = message.content ?? {};
    if (type === 'output') {
        if (data?.isSidechain) return 'other';
        const content = data?.message?.content;
        if (data?.type === 'assistant') return hasTextBlock(content) ? 'text' : 'other';
        // A prompt in Claude's transcript, unless it only hands back tool results
        if (data?.type === 'user') {
            if (typeof content === 'string') return 'text';
            return hasTextBlock(content) && !content.some((block: any) => block?.type === 'tool_result') ? 'text' : 'other';
        }
        return 'other';
    }
    if (type === 'codex' || type === 'acp') {
        return data?.type === 'message' && typeof data.message === 'string' ? 'text' : 'other';
    }
    if (type === 'session') return envelopeHasText(data) ? 'text' : 'other';
    return 'other';
}

function hasTextBlock(content: unknown): content is any[] {
    return Array.isArray(content) && content.some((block) => block?.type === 'text' && typeof block.text === 'string');
}

function envelopeHasText(envelope: any): boolean {
    return envelope?.ev?.t === 'text' && typeof envelope.ev.text === 'string' && envelope.ev.thinking !== true && !envelope.subagent;
}
