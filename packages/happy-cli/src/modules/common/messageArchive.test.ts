import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { MessageArchiveWriter, searchMessageArchive } from './messageArchive';

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: '/tmp/happy-cli-test-message-archive',
    },
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

const archiveDir = join(configuration.happyHomeDir, 'messages');

function writerFor(sessionId: string) {
    return new MessageArchiveWriter(() => ({ sessionId, machineId: 'machine-1', agent: 'claude', path: '/work', host: 'box' }));
}

function message(id: string, seq: number, text: string, role: 'user' | 'agent' = 'user') {
    return { type: 'message' as const, role, text, id, seq, localId: `local-${id}`, createdAt: 1000 + seq };
}

async function flush(writer: MessageArchiveWriter) {
    await (writer as unknown as { chain: Promise<void> }).chain;
}

describe('messageArchive', () => {
    afterEach(() => {
        rmSync(configuration.happyHomeDir, { recursive: true, force: true });
    });

    it('writes the header once, then one line per message, newlines included', async () => {
        const writer = writerFor('session-a');
        writer.append([message('m1', 1, 'first\nline two')]);
        writer.append([message('m2', 2, 'second')]);
        await flush(writer);

        const file = join(archiveDir, 'session-a.jsonl');
        const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
        expect(lines).toHaveLength(3);
        expect(JSON.parse(lines[0])).toMatchObject({ type: 'header', v: 1, sessionId: 'session-a', machineId: 'machine-1', agent: 'claude', path: '/work', host: 'box' });
        expect(JSON.parse(lines[1])).toMatchObject({ type: 'message', text: 'first\nline two', id: 'm1', seq: 1 });
        expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it('finds the newest hits first, per session and across sessions', async () => {
        const older = writerFor('session-old');
        older.append([message('o1', 1, 'deploy token old')]);
        await flush(older);
        const newer = writerFor('session-new');
        newer.append([message('n1', 1, 'deploy the token'), message('n2', 5, 'unrelated'), message('n3', 9, 'Token for deploy', 'agent')]);
        await flush(newer);

        const { hits } = await searchMessageArchive({ query: 'deploy token' });
        expect(hits.map((hit) => [hit.sessionId, hit.id])).toEqual([
            ['session-new', 'n3'],
            ['session-new', 'n1'],
            ['session-old', 'o1'],
        ]);
        expect(hits[0]).toMatchObject({ seq: 9, localId: 'local-n3', role: 'agent', snippet: 'Token for deploy' });

        const limited = await searchMessageArchive({ query: 'deploy token', perSessionLimit: 1, limit: 2 });
        expect(limited.hits.map((hit) => hit.id)).toEqual(['n3', 'o1']);
    });

    it('skips a broken line and a message written twice, and sees later appends', async () => {
        const writer = writerFor('session-b');
        writer.append([message('m1', 1, 'alpha one')]);
        await flush(writer);
        appendFileSync(join(archiveDir, 'session-b.jsonl'), '{"type":"message","role":"us\n');
        writer.append([message('m1', 1, 'alpha one'), message('m2', 2, 'alpha two')]);
        await flush(writer);

        const { hits } = await searchMessageArchive({ query: 'alpha' });
        expect(hits.map((hit) => hit.id)).toEqual(['m2', 'm1']);
    });

    it('returns nothing without an archive or for a one-letter query', async () => {
        expect(await searchMessageArchive({ query: 'anything' })).toEqual({ hits: [] });
        const writer = writerFor('session-c');
        writer.append([message('m1', 1, 'a b c')]);
        await flush(writer);
        expect(await searchMessageArchive({ query: 'a' })).toEqual({ hits: [] });
    });
});
