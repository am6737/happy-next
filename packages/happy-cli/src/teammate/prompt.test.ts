import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeammateThreadKind } from 'happy-wire';
import { buildTeammateSystemPrompt, teammateMemoryFiles } from './prompt';
import { makeTeammate } from './testFixtures';

vi.mock('@/configuration', () => ({ configuration: {} }));

describe('teammate system prompt', () => {
    it('uses the thread kind as the source of truth for memory files', () => {
        expect(teammateMemoryFiles('group')).toEqual(['USER.md']);
        expect(teammateMemoryFiles('dm')).toEqual(['USER.md', 'MEMORY.md']);
        expect(teammateMemoryFiles('task')).toEqual(['USER.md', 'MEMORY.md']);
    });
    let dir: string;
    const now = new Date(2026, 0, 1, 12, 30);
    const files = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'memory/2026-01-01.md', 'memory/2025-12-31.md'];
    const build = (kind: TeammateThreadKind = 'dm') => buildTeammateSystemPrompt({
        dir, teammate: makeTeammate(), threadKind: kind, now,
        threadContext: { kind, channelTitle: 'Engineering', taskTitle: 'Fix login', taskUrl: 'https://github.com/owner/repo/issues/1', extra: { runId: 'run-1' } },
    });

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'happy-teammate-prompt-'));
        await mkdir(join(dir, 'memory'));
    });
    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(dir, { recursive: true, force: true });
    });

    it('loads profiles, today, yesterday, then the current thread in order', async () => {
        for (const file of files) await writeFile(join(dir, file), `Content of ${file}`);
        const prompt = await build();
        expect(prompt.match(/^## .+$/gm)).toEqual([...files, 'Current thread'].map(file => `## ${file}`));
        expect(prompt).toContain('Teammate: Atlas');
        expect(prompt).toContain('Kind: dm');
        expect(prompt).toContain('Channel: Engineering');
        expect(prompt).toContain('Task: Fix login');
        expect(prompt).toContain('Task URL: https://github.com/owner/repo/issues/1');
        expect(prompt).toContain('"runId": "run-1"');
    });

    it.each(['group', 'dm', 'task', 'heartbeat', 'dreaming'] as const)('loads private MEMORY only outside group threads (%s)', async kind => {
        await writeFile(join(dir, 'MEMORY.md'), 'PRIVATE_MEMORY_SENTINEL');
        await writeFile(join(dir, 'memory', '2026-01-01.md'), 'Daily learning');
        const prompt = await build(kind);
        expect(prompt.includes('## MEMORY.md')).toBe(kind !== 'group');
        expect(prompt.includes('PRIVATE_MEMORY_SENTINEL')).toBe(kind !== 'group');
        expect(prompt).toContain('Daily learning');
    });

    it('caps every file at 20,000 characters with a visible truncation marker', async () => {
        for (const file of files) await writeFile(join(dir, file), 'x'.repeat(20_001));
        const prompt = await build();
        for (const section of prompt.split('## ').slice(1, -1)) {
            const content = section.slice(section.indexOf('\n\n') + 2).trimEnd();
            expect(content).toHaveLength(20_000);
            expect(content.endsWith('…[truncated]')).toBe(true);
        }
        await writeFile(join(dir, 'AGENTS.md'), 'y'.repeat(20_000));
        expect((await build()).split('## SOUL.md')[0]).not.toContain('…[truncated]');
    });

    it('skips missing files and still renders current thread context', async () => {
        await writeFile(join(dir, 'SOUL.md'), 'Persona only');
        const prompt = await build();
        expect(prompt.match(/^## .+$/gm)).toEqual(['## SOUL.md', '## Current thread']);
        expect(prompt).toContain('Persona only');
    });

    it('selects today and yesterday by local calendar dates', async () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        await writeFile(join(dir, 'memory', '2026-01-01.md'), 'Local today');
        await writeFile(join(dir, 'memory', '2025-12-31.md'), 'Local yesterday');
        await writeFile(join(dir, 'memory', '2026-01-02.md'), 'UTC day should not load');
        const prompt = await buildTeammateSystemPrompt({
            dir, teammate: makeTeammate(), threadKind: 'dm',
            threadContext: { kind: 'dm' }, now: new Date('2026-01-02T01:04:00Z'),
        });
        expect(prompt).toContain('Local today');
        expect(prompt).toContain('Local yesterday');
        expect(prompt).not.toContain('UTC day should not load');
    });

    it('renders string extra context without JSON quotes', async () => {
        const prompt = await buildTeammateSystemPrompt({
            dir, teammate: makeTeammate(), threadKind: 'task', now,
            threadContext: { kind: 'task', extra: 'The worker finished.' },
        });
        expect(prompt).toContain('Extra: The worker finished.');
    });
});
