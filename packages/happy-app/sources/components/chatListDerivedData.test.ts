import { describe, expect, it } from 'vitest';
import { ASK_USER_QUESTION_TOOL, type Message, type ToolCallMessage } from '@/sync/typesMessage';
import { buildChatKeyIndex, buildChatLandmarkRows, selectChatLandmarkMessages } from './chatListDerivedData';
import { railLandmarkRows } from './chatListVisibility';

function agent(id: string): Message {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: id };
}
function user(id: string): Message {
    return { kind: 'user-text', id, localId: null, createdAt: 0, text: id };
}
function tool(id: string, name: string): ToolCallMessage {
    return { kind: 'tool-call', id, localId: null, createdAt: 0, children: [], tool: {
        name, state: 'running', input: {}, createdAt: 0, startedAt: null, completedAt: null, description: null,
    } };
}

describe('native chat derived data', () => {
    it('keeps minimap inputs stable for body updates and new normal replies', () => {
        const prompt = user('u');
        const messages = [agent('a'), prompt];
        const previous = selectChatLandmarkMessages(messages);
        Object.freeze(previous);
        expect(selectChatLandmarkMessages([agent('a'), prompt], previous)).toBe(previous);
        expect(selectChatLandmarkMessages([agent('b'), ...messages], previous)).toBe(previous);
    });

    it('includes questions and previews, but not ordinary tools or sidechain landmarks', () => {
        const question = tool('q', ASK_USER_QUESTION_TOOL);
        const preview = tool('p', 'preview_html');
        const ordinary = { ...tool('t', 'Read'), children: [question] };
        const prompt = user('u');
        expect(selectChatLandmarkMessages([agent('a'), question, preview, ordinary, prompt])).toEqual([question, preview, prompt]);
    });

    it('invalidates for question answers, completed previews and prompt edits', () => {
        const question = tool('q', ASK_USER_QUESTION_TOOL);
        const preview = tool('p', 'preview_html');
        const prompt = user('u');
        let previous = selectChatLandmarkMessages([question, preview, prompt]);
        const answered = { ...question, tool: { ...question.tool, permission: { id: 'q', status: 'approved' as const, answers: { q: 'yes' } } } };
        const completed = { ...preview, tool: { ...preview.tool, state: 'completed' as const } };
        for (const messages of [[answered, preview, prompt], [answered, completed, prompt], [answered, completed, user('u')]]) {
            const next = selectChatLandmarkMessages(messages, previous);
            expect(next).not.toBe(previous);
            expect(next).toEqual(messages);
            previous = next;
        }
    });

    it('handles removing the last landmark and reordering them', () => {
        const a = user('a');
        const b = user('b');
        const previous = selectChatLandmarkMessages([a, b]);
        expect(selectChatLandmarkMessages([a], previous)).toEqual([a]);
        expect(selectChatLandmarkMessages([b, a], previous)).toEqual([b, a]);
        expect(selectChatLandmarkMessages([], previous)).toEqual([]);
        expect(previous).toEqual([a, b]);
    });

    it('reuses the key index on content updates but not structural changes', () => {
        const messages = [agent('a'), user('u')];
        const previous = buildChatKeyIndex(messages);
        expect(buildChatKeyIndex([agent('a'), user('u')], previous)).toBe(previous);
        for (const next of [[...messages].reverse(), [agent('new'), ...messages], [...messages, user('older')], [messages[0]], []]) {
            expect(buildChatKeyIndex(next, previous)).toEqual(new Map(next.map((message, index) => [message.id, index])));
            expect(buildChatKeyIndex(next, previous)).not.toBe(previous);
        }
        expect([...previous]).toEqual([['a', 0], ['u', 1]]);
    });

    it('keeps rail positions equivalent, excluding cached-only IDs and deduplicating IDs', () => {
        const messages = [agent('a'), user('u'), tool('q', ASK_USER_QUESTION_TOOL), user('old')];
        const ids = ['cached-only', 'old', 'q', 'u', 'u'];
        const previous = buildChatKeyIndex(messages);
        expect(buildChatLandmarkRows(previous, ids)).toEqual(railLandmarkRows(messages, new Set(ids)));
        const inserted = [agent('new'), ...messages];
        expect(buildChatLandmarkRows(buildChatKeyIndex(inserted, previous), ids)).toEqual(railLandmarkRows(inserted, new Set(ids)));
    });
});
