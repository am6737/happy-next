import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSummaryPrompt, parseSummary, summarizeThread } from './threadSummary';
import { readThreadsState } from './homeDir';
import { dailyLogDate } from './dailyLogDate';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

describe('thread summary', () => {
    it('builds a prompt with rules and all input blocks', () => {
        const built = buildSummaryPrompt({ previous: 'old', messages: 'channel', transcript: 'agent', kind: 'dm', final: true });
        expect(built.systemPrompt).toContain('Do not invent anything');
        expect(built.prompt).toContain('<previous-summary>');
        expect(built.prompt).toContain('<messages>\nchannel');
        expect(built.prompt).toContain('<agent-transcript>\nagent');
        expect(built.prompt).toContain('final: true');
    });

    it('parses the last summary block, caps output, and limits durable lines', () => {
        const durable = Array.from({ length: 25 }, (_, index) => `- fact ${index}`).join('\n');
        const parsed = parseSummary(`<summary>old</summary><summary>${'x'.repeat(9000)}</summary><durable>${durable}</durable>`);
        expect(parsed?.summary).toHaveLength(8000);
        expect(parsed?.summary).toContain('[truncated]');
        expect(parsed?.durable).toHaveLength(20);
        expect(parsed?.durable[0]).toBe('fact 0');
        expect(parseSummary('<summary> </summary>')).toBeNull();
        expect(parseSummary('missing')).toBeNull();
    });

    it('summarizes only incremental channel messages and tolerates transcript failure', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-')); homes.push(home);
        const oneShot = vi.fn(async ({ prompt }: { prompt: string }) => `<summary>${prompt}</summary>`);
        const api = {
            getChannelMessages: vi.fn(async () => [
                { seq: 1, createdAt: 10, senderId: 'u', content: { t: 'system', code: 'old', data: {} } },
                { seq: 2, createdAt: 20, senderId: 'u', content: { t: 'system', code: 'reset', data: {} } },
                { seq: 3, createdAt: 30, senderId: 'u', content: { t: 'system', code: 'keep', data: {} } },
                { seq: 4, createdAt: 400, senderId: 'u', content: { t: 'system', code: 'late', data: {} } },
            ]),
            getSessionMessages: vi.fn(async () => { throw new Error('gone'); }),
        };
        const result = await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: false,
            entry: { channel: { id: 'channel-1', teammateEncryptedDataKey: 'wrapped', members: [{ id: 'u', name: 'Owner' }] }, summarizedSeq: 2, resetAppliedAt: 20, currentSessionId: 'session-1', keyPath: join(home, 'missing') } as any,
            untilCreatedAt: 100, deps: { api: api as any, crypto: { unwrap: () => new Uint8Array() }, oneShot, provider: 'claude' } });
        expect(result).not.toBeNull();
        expect(oneShot).toHaveBeenCalledTimes(1);
        expect(oneShot.mock.calls[0][0].prompt).toContain('keep');
        expect(oneShot.mock.calls[0][0].prompt).not.toContain('old');
        expect(oneShot.mock.calls[0][0].prompt).not.toContain('late');
    });

    it('does not call the model when a non-final summary has no new input', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-empty-')); homes.push(home);
        const oneShot = vi.fn();
        const result = await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: false, entry: {} as any,
            deps: { oneShot, api: { getChannelMessages: vi.fn(async () => []), getSessionMessages: vi.fn() } as any } });
        expect(result).toBeNull();
        expect(oneShot).not.toHaveBeenCalled();
    });

    it('writes durable lines once per segment', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-durable-')); homes.push(home);
        const now = () => Date.UTC(2026, 9, 9, 12);
        const oneShot = vi.fn(async () => '<summary>## Decisions</summary><durable>\n- Alex prefers small PRs\n</durable>');
        await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry: { segment: 3 } as any, deps: { oneShot, now } });
        const entry = (await readThreadsState(home))['thread-1'];
        expect(entry.flushedSegment).toBe(3);
        await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry, deps: { oneShot, now } });
        const log = await readFile(join(home, 'memory', `${dailyLogDate(new Date(now()))}.md`), 'utf8');
        expect(log.match(/\[thread thread-1 seg 3 seq 0–0\] Alex prefers small PRs/g)).toHaveLength(1);
    });

    it('keeps existing files unchanged when output is invalid', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-invalid-')); homes.push(home);
        const oneShot = vi.fn(async () => 'not a summary');
        const result = await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry: {} as any, deps: { oneShot } });
        expect(result).toBeNull();
        await expect(readFile(join(home, 'state', 'threads.json'))).rejects.toThrow();
    });
});
