import { describe, expect, it } from 'vitest';
import { textGroupEndingAt } from './messageTextGroup';
import type { AgentTextMessage, Message, UserTextMessage } from '@/sync/typesMessage';

function user(id: string): UserTextMessage {
    return { kind: 'user-text', id, localId: null, createdAt: 0, text: id };
}

function agent(id: string, overrides: Partial<AgentTextMessage> = {}): AgentTextMessage {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: id, ...overrides };
}

function tool(id: string): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        tool: { name: 'Read', state: 'completed', input: {}, createdAt: 0, startedAt: 0, completedAt: 0, description: null },
        children: [],
    };
}

function event(id: string): Message {
    return { kind: 'agent-event', id, createdAt: 0, event: { type: 'message', message: id } };
}

// Newest first, the order the store keeps them in.
const turn: Message[] = [agent('a5'), agent('a4'), tool('t3'), agent('a2'), agent('a1'), user('u1')];

describe('textGroupEndingAt', () => {
    it('joins a text with the run of texts right above it, never the ones below', () => {
        expect(textGroupEndingAt(turn, 'a1', true)).toBe('a1');
        expect(textGroupEndingAt(turn, 'a2', true)).toBe('a1\n\na2');
        expect(textGroupEndingAt(turn, 'a4', true)).toBe('a4');
        expect(textGroupEndingAt(turn, 'a5', true)).toBe('a4\n\na5');
    });

    it('stops at the end of the turn before, where the CLI\'s turn stamp changes', () => {
        // A turn the agent started on its own, right under the previous turn's answer.
        const resumed = [
            agent('b2', { meta: { turn: 'B' } }),
            agent('b1', { meta: { turn: 'B' } }),
            agent('a2', { meta: { turn: 'A' } }),
            agent('a1', { meta: { turn: 'A' } }),
            user('u1'),
        ];
        expect(textGroupEndingAt(resumed, 'b2', true)).toBe('b1\n\nb2');
        expect(textGroupEndingAt(resumed, 'a2', true)).toBe('a1\n\na2');
    });

    it('reads unstamped rows as one turn', () => {
        expect(textGroupEndingAt([agent('a2'), agent('a1', { meta: { turn: 'A' } })], 'a2', true)).toBe('a1\n\na2');
    });

    it('leaves a lone text to itself', () => {
        expect(textGroupEndingAt([agent('a2'), tool('t1'), agent('a1'), user('u1')], 'a2', true)).toBe('a2');
    });

    it('ends a run at shown thinking, notices and prompts', () => {
        const thinking = [agent('a2'), agent('think', { isThinking: true }), agent('a1')];
        expect(textGroupEndingAt(thinking, 'a2', true)).toBe('a2');
        expect(textGroupEndingAt([agent('a2'), event('e1'), agent('a1')], 'a2', true)).toBe('a2');
        expect(textGroupEndingAt([agent('a2'), user('u2'), agent('a1')], 'a2', true)).toBe('a2');
    });

    it('reads across thinking the list hides', () => {
        const thinking = [agent('a2'), agent('think', { isThinking: true }), agent('a1')];
        expect(textGroupEndingAt(thinking, 'a2', false)).toBe('a1\n\na2');
    });

    it('answers null for a row that is missing or not a text', () => {
        expect(textGroupEndingAt(turn, 'missing', true)).toBeNull();
        expect(textGroupEndingAt(turn, 't3', true)).toBeNull();
    });
});
