import { describe, expect, it } from 'vitest';
import { encodeBase64, encrypt } from '@/api/encryption';
import { lastWorkerReply, renderWorkerTranscript } from './transcript';

const key = new Uint8Array(32).fill(41);
const message = (seq: number, record: unknown) => ({ seq, content: { t: 'encrypted' as const, c: encodeBase64(encrypt(key, 'dataKey', record)) } });
const output = (type: string, content: unknown) => ({ role: 'agent', content: { type: 'output', data: { type, message: { content } } } });

describe('worker transcript', () => {
    it('renders Claude user/assistant/tool records oldest first and omits results and unknowns', () => {
        const result = renderWorkerTranscript([
            message(4, output('user', [{ type: 'tool_result', content: 'secret result' }])),
            message(3, output('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'yarn test' } }])),
            message(2, output('assistant', [{ type: 'text', text: 'Working' }])),
            message(1, { role: 'user', content: { type: 'text', text: 'Please fix' } }),
            message(5, output('system', 'skip')),
            { seq: 6, content: { t: 'encrypted', c: 'invalid' } },
        ], key);
        expect(result).toBe('user: Please fix\nassistant: Working\n[tool] Bash: {"command":"yarn test"}');
    });
    it('handles Codex, Gemini ACP, session envelopes and hyphenated tool calls', () => {
        const record = (type: string, data: unknown) => ({ role: 'agent', content: { type, data } });
        const result = renderWorkerTranscript([
            message(1, record('codex', { type: 'message', message: 'Codex answer' })),
            message(2, record('acp', { type: 'message', message: 'Gemini answer' })),
            message(3, record('acp', { type: 'tool-call', name: 'Read', input: { path: 'file.ts' } })),
            message(4, record('acp', { type: 'tool-result', output: 'omit me' })),
            message(5, record('session', { role: 'agent', ev: { t: 'text', text: 'Envelope answer' } })),
            message(6, record('session', { role: 'agent', ev: { t: 'tool-call-start', name: 'Bash', args: { command: 'pwd' } } })),
            message(7, output('assistant', [{ type: 'tool-call', name: 'Edit', input: { path: 'README' } }])),
        ], key);
        expect(result).toBe('assistant: Codex answer\nassistant: Gemini answer\n[tool] Read: {"path":"file.ts"}\nassistant: Envelope answer\n[tool] Bash: {"command":"pwd"}\n[tool] Edit: {"path":"README"}');
    });
    it('keeps mixed user text, handles session-role envelopes, and skips unknown record roles', () => {
        const result = renderWorkerTranscript([
            message(1, { role: 'user', content: { type: 'mixed', text: 'Look at this image', images: [] } }),
            message(2, { role: 'session', content: { type: 'session', data: { role: 'agent', ev: { t: 'text', text: 'Seen' } } } }),
            message(3, { role: 'unknown', content: { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'skip' }] } } } }),
        ], key);
        expect(result).toBe('user: Look at this image\nassistant: Seen');
    });
    it('truncates assistant blocks and input summaries, caps output and trims oldest entries', () => {
        const messages = Array.from({ length: 12 }, (_, i) => message(i, output('assistant', [{ type: 'text', text: `block-${i} ` + 'x'.repeat(3000) }])));
        const result = renderWorkerTranscript(messages, key);
        expect(result.length).toBeLessThanOrEqual(20000);
        expect(result).not.toContain('block-0 ');
        expect(result).toContain('block-11 ');
        expect(result.split('\n').every(line => line.length === 2011)).toBe(true);
        const tool = renderWorkerTranscript([message(1, output('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(1000) } }]))], key);
        expect(tool.length).toBe('[tool] Bash: '.length + 300);
    });
    it('returns the last assistant reply uncapped, or null while the latest prompt is unanswered', () => {
        const long = 'final ' + 'y'.repeat(5000);
        const codex = (text: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } });
        expect(lastWorkerReply([message(1, codex('progress')), message(2, output('assistant', [{ type: 'tool_use', name: 'Bash', input: {} }])), message(3, codex(long))], key)).toBe(long);
        expect(lastWorkerReply([message(1, codex('done')), message(2, { role: 'user', content: { type: 'text', text: 'Follow up' } })], key)).toBeNull();
        expect(lastWorkerReply([], key)).toBeNull();
    });
});
