import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSummaryPrompt, parseSummary, summarizeThread } from './threadSummary';
import { readThreadsState, writeSessionKeyFile } from './homeDir';
import { dailyLogDate } from './dailyLogDate';
import { encodeBase64, encrypt } from '@/api/encryption';

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
        expect(built.prompt.endsWith('Wrap the summary in <summary></summary> and follow it with the <durable></durable> block. Use these headings in the summary:\n## Goal and background\n## Current instruction\n## Decisions\n## In progress\n## Open commitments\n## Mistakes and corrections\n## References\n## Search hints')).toBe(true);
    });

    it('builds task rules and headings, including known memory only for final summaries', () => {
        const task = buildSummaryPrompt({ previous: null, messages: '', transcript: '', kind: 'task', final: true, taskState: 'Worker sessionId=worker-1 branch=feature/x', knownMemory: '## MEMORY.md\nremembered' });
        expect(task.systemPrompt).toContain('Keep the task status, PR URL, review round');
        expect(task.systemPrompt).toContain('blocking points stay open');
        expect(task.prompt).toContain('<task-state>\nWorker sessionId=worker-1 branch=feature/x');
        expect(task.prompt).toContain('## Task state');
        expect(task.prompt).toContain('<known-memory>\n## MEMORY.md\nremembered');
        expect(buildSummaryPrompt({ previous: null, messages: '', transcript: '', kind: 'task', final: false }).prompt).not.toContain('<known-memory>');
    });

    it('summarizes task state and user wake entries without reading the channel', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-task-')); homes.push(home);
        await mkdir(join(home, 'state', 'tasks'), { recursive: true });
        const key = new Uint8Array(32).fill(9);
        const keyPath = await writeSessionKeyFile(home, 'worker-key', key);
        await writeFile(join(home, 'state', 'tasks', 'task-1.json'), JSON.stringify({ workers: {
            builder: { sessionId: 'worker-1', keyPath, pid: 1, provider: 'claude', repo: 'owner/repo', basePath: home, worktreePath: home, branch: 'feature/x', title: 'Build', startedAt: 1000, stoppedAt: 2000 },
        } }));
        const wake = 'head '.repeat(1200) + 'TAIL_WAKE';
        const reply = 'worker finished';
        const encrypted = (seq: number, data: unknown) => ({ seq, content: { t: 'encrypted' as const, c: encodeBase64(encrypt(key, 'dataKey', data)) } });
        const api = {
            getChannelMessages: vi.fn(),
            getSessionMessages: vi.fn(async (sessionId: string) => ({ messages: sessionId === 'controller'
                ? [encrypted(1, { role: 'user', content: wake })]
                : [encrypted(1, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: reply } } })] })),
        };
        const oneShot = vi.fn(async ({ prompt }: { prompt: string }) => { expect(prompt).toContain('TAIL_WAKE'); expect(prompt).toContain('…[truncated]'); expect(prompt).toContain('feature/x'); expect(prompt).toContain(reply); return '<summary>task</summary><durable></durable>'; });
        const result = await summarizeThread({ home, threadId: 'thread-task', kind: 'task', final: false, entry: {
            task: { id: 'task-1', title: 'Fix', resourceId: 'owner/repo#1', url: null, status: 'in_progress', prUrl: null, reviewRound: 2, summary: 'Working', teammateId: 'a', createdByTeammateId: null, source: 'github-issue', createdAt: 1, updatedAt: 1 },
            currentSessionId: 'controller', keyPath, summarizedSession: { id: 'controller', seq: 0 },
        } as any, deps: { api: api as any, oneShot, provider: 'claude' } });
        expect(result).not.toBeNull();
        expect(api.getChannelMessages).not.toHaveBeenCalled();
        expect(oneShot).toHaveBeenCalledTimes(1);
    });

    it('renders an unavailable task reply when a worker key cannot be read', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-task-missing-')); homes.push(home);
        await mkdir(join(home, 'state', 'tasks'), { recursive: true });
        await writeFile(join(home, 'state', 'tasks', 'task-1.json'), JSON.stringify({ workers: {
            builder: { sessionId: 'worker-1', keyPath: join(home, 'missing.key'), pid: 1, provider: 'claude', repo: 'owner/repo', basePath: home, worktreePath: home, branch: 'feature/x', title: 'Build', startedAt: 1000 },
        } }));
        const oneShot = vi.fn(async ({ prompt }: { prompt: string }) => { expect(prompt).toContain('(reply unavailable)'); return '<summary>task</summary><durable></durable>'; });
        await summarizeThread({ home, threadId: 'thread-task', kind: 'task', final: true, entry: { task: { id: 'task-1' } } as any,
            deps: { api: { getSessionMessages: vi.fn(async () => ({ messages: [] })) } as any, oneShot } });
    });

    it('tags task durable lines with the task and keeps MEMORY.md out of group known memory', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-tags-')); homes.push(home);
        const now = () => Date.UTC(2026, 9, 9, 12);
        await mkdir(join(home, 'memory'), { recursive: true });
        await writeFile(join(home, 'MEMORY.md'), 'PRIVATE_MEMORY');
        await writeFile(join(home, 'memory', `${dailyLogDate(new Date(now()))}.md`), '- 10:00 TODAY_NOTE\n');
        const prompts: string[] = [];
        const oneShot = vi.fn(async ({ prompt, systemPrompt }: { prompt: string; systemPrompt: string }) => {
            prompts.push(prompt);
            expect(systemPrompt).toContain('quotes the owner\'s words in quotation marks');
            return `<summary>s</summary><durable>\n- Owner said "use ${prompts.length === 1 ? 'pnpm' : 'vitest'}"\n</durable>`;
        });
        await summarizeThread({ home, threadId: 'thread-g', kind: 'group', final: true, entry: {} as any, deps: { oneShot, now } });
        expect(prompts[0]).toContain('TODAY_NOTE');
        expect(prompts[0]).not.toContain('PRIVATE_MEMORY');
        await summarizeThread({ home, threadId: 'thread-t', kind: 'task', final: true, entry: { segment: 2, task: { id: 'task-9' } } as any, deps: { oneShot, now } });
        expect(prompts[1]).toContain('PRIVATE_MEMORY');
        const log = await readFile(join(home, 'memory', `${dailyLogDate(new Date(now()))}.md`), 'utf8');
        expect(log).toContain('[task task-9 seg 2] Owner said "use vitest"');
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
        expect(parseSummary('## Goal and background\nSpoke\n\n<durable>\n- Owner said "use Stripe"\n</durable>')).toEqual({ summary: '## Goal and background\nSpoke', durable: ['Owner said "use Stripe"'] });
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
        await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry: { segment: 3, segmentStartSeq: 17, summarizedSeq: 20 } as any, deps: { oneShot, now } });
        const entry = (await readThreadsState(home))['thread-1'];
        expect(entry.flushedSegment).toBe(3);
        await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry, deps: { oneShot, now } });
        const log = await readFile(join(home, 'memory', `${dailyLogDate(new Date(now()))}.md`), 'utf8');
        expect(log.match(/\[thread thread-1 seg 3 seq 17–20\] Alex prefers small PRs/g)).toHaveLength(1);
    });

    it('skips durable lines that are already saved or repeated', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-dedupe-')); homes.push(home);
        const now = () => Date.UTC(2026, 9, 9, 12);
        const logPath = join(home, 'memory', `${dailyLogDate(new Date(now()))}.md`);
        await mkdir(join(home, 'memory'), { recursive: true });
        await writeFile(logPath, '- 10:00 [thread other seg 1 seq 1–3] Owner prefers “weekly demos on Fridays”. (run r1)\n');
        const oneShot = vi.fn(async () => '<summary>s</summary><durable>\n- owner prefers "weekly demos on Fridays"\n- Owner chose Fly.io\n- Owner chose Fly.io.\n</durable>');
        await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry: {} as any, deps: { oneShot, now } });
        const log = await readFile(logPath, 'utf8');
        expect(log.match(/weekly demos/g)).toHaveLength(1);
        expect(log.match(/Fly\.io/g)).toHaveLength(1);
    });

    it('keeps existing files unchanged when output is invalid', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happy-summary-invalid-')); homes.push(home);
        const oneShot = vi.fn(async () => 'not a summary');
        const result = await summarizeThread({ home, threadId: 'thread-1', kind: 'dm', final: true, entry: {} as any, deps: { oneShot } });
        expect(result).toBeNull();
        await expect(readFile(join(home, 'state', 'threads.json'))).rejects.toThrow();
    });
});
