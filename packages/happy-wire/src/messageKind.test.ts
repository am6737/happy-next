import { describe, expect, it } from 'vitest';
import { messageKind } from './messageKind';

const output = (data: unknown) => ({ role: 'agent', content: { type: 'output', data } });

describe('messageKind', () => {
    it('puts every user record under text', () => {
        expect(messageKind({ role: 'user', content: { type: 'text', text: 'hi' } })).toBe('text');
        expect(messageKind({ role: 'user', content: { type: 'text', text: 'summary' }, meta: { isCompactSummary: true } })).toBe('text');
    });

    it('sorts Claude replies by whether they hold text', () => {
        expect(messageKind(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'one' }] } }))).toBe('text');
        expect(messageKind(output({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }))).toBe('other');
        expect(messageKind(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } }))).toBe('other');
        expect(messageKind(output({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'x' }] } }))).toBe('other');
    });

    it('keeps transcript prompts and leaves tool results out', () => {
        expect(messageKind(output({ type: 'user', message: { content: 'typed' } }))).toBe('text');
        expect(messageKind(output({ type: 'user', message: { content: [{ type: 'text', text: 'typed' }] } }))).toBe('text');
        expect(messageKind(output({ type: 'user', message: { content: [{ type: 'tool_result', content: 'out' }] } }))).toBe('other');
        expect(messageKind(output({ type: 'summary' }))).toBe('other');
    });

    it('sorts codex and acp records', () => {
        expect(messageKind({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'done' } } })).toBe('text');
        expect(messageKind({ role: 'agent', content: { type: 'acp', data: { type: 'tool-call', name: 'x' } } })).toBe('other');
    });

    it('sorts session envelopes', () => {
        const envelope = (ev: unknown, extra = {}) => ({ role: 'session', content: { type: 'session', data: { ev, ...extra } } });
        expect(messageKind(envelope({ t: 'text', text: 'hi' }))).toBe('text');
        expect(messageKind(envelope({ t: 'text', text: 'hmm', thinking: true }))).toBe('other');
        expect(messageKind(envelope({ t: 'text', text: 'x' }, { subagent: 'a' }))).toBe('other');
        expect(messageKind(envelope({ t: 'tool-call-start' }))).toBe('other');
        expect(messageKind({ role: 'agent', content: { type: 'session', data: { ev: { t: 'text', text: 'hi' } } } })).toBe('text');
    });

    it('puts events and anything unknown under other', () => {
        expect(messageKind({ role: 'agent', content: { type: 'event', data: { type: 'ready' } } })).toBe('other');
        expect(messageKind(null)).toBe('other');
    });
});
