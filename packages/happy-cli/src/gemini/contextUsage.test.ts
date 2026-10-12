import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMaxContextSize } from 'happy-wire';
import { readGeminiContextUsage } from './contextUsage';

const SESSION_ID = 'fc315558-5f03-40ba-b9d1-905e7e9606fa';

const reply = (input: number, extra: Record<string, unknown> = {}) => ({
    type: 'gemini',
    model: 'gemini-3.5-flash-lite',
    tokens: { input, output: 2, cached: 0, thoughts: 0, tool: 0, total: input + 2 },
    ...extra,
});

describe('readGeminiContextUsage', () => {
    let home: string;

    const writeChat = (projectDir: string, fileName: string, records: unknown[]) => {
        const chatsDir = join(home, '.gemini', 'tmp', projectDir, 'chats');
        mkdirSync(chatsDir, { recursive: true });
        writeFileSync(join(chatsDir, fileName), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    };

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'gemini-context-'));
        vi.stubEnv('GEMINI_CLI_HOME', home);
        mkdirSync(join(home, '.gemini'), { recursive: true });
        writeFileSync(join(home, '.gemini', 'projects.json'), JSON.stringify({ projects: { '/repo/work': 'work' } }));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
    });

    it('reads the input of the latest request, not the sum over the turn', async () => {
        writeChat('work', 'session-2026-10-11T22-04-fc315558.jsonl', [
            { sessionId: SESSION_ID, kind: 'main' },
            reply(10291),
            reply(23513, { toolCalls: [{ name: 'read_file' }] }),
            reply(24413),
            { $set: { lastUpdated: '2026-10-11T22:04:46.800Z' } },
        ]);

        expect(await readGeminiContextUsage(SESSION_ID, '/repo/work')).toEqual({
            usedTokens: 24413,
            windowSize: getMaxContextSize('gemini-3.5-flash-lite', 'gemini'),
        });
    });

    it('reads a recording rewritten as one set of messages', async () => {
        writeChat('work', `session-${SESSION_ID}.jsonl`, [
            { sessionId: SESSION_ID, kind: 'main' },
            { $set: { messages: [{ type: 'user', content: 'hi' }, reply(5000), reply(7000), { type: 'user', content: 'again' }] } },
        ]);

        expect(await readGeminiContextUsage(SESSION_ID, '/repo/work')).toMatchObject({ usedTokens: 7000 });
    });

    it('looks in every project when the working directory is not listed', async () => {
        writeChat('other', 'session-2026-10-11T22-04-fc315558.jsonl', [reply(1200)]);

        expect(await readGeminiContextUsage(SESSION_ID, '/unlisted')).toMatchObject({ usedTokens: 1200 });
    });

    it('returns null without a recording or a reply with tokens', async () => {
        expect(await readGeminiContextUsage(SESSION_ID, '/repo/work')).toBeNull();

        writeChat('work', 'session-2026-10-11T22-04-fc315558.jsonl', [{ sessionId: SESSION_ID }, { type: 'user', content: 'hi' }]);
        expect(await readGeminiContextUsage(SESSION_ID, '/repo/work')).toBeNull();
    });
});
