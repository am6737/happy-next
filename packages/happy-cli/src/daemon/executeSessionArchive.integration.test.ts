import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CodexJsonRpcPeer } from '@/codex/appserver/CodexJsonRpcPeer';
import { CodexAppServerBackend } from '@/codex/appserver/CodexAppServerBackend';
import { configuration } from '@/configuration';
import type { Metadata } from '@/api/types';
import { recordSessionBinding, readSessionBinding } from './sessionBinding';
import { syncCodexArchive } from './executeSessionArchive';

it('archives a goal-only thread after its original app-server exits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'happy-empty-native-'));
    const sessionId = `empty-native-${Date.now()}`;
    const codexHome = join(directory, 'codex');
    mkdirSync(codexHome);
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const backend = new CodexAppServerBackend({ cwd: directory, command: 'npx', args: ['-y', '@openai/codex@0.145.0', 'app-server'] });
    const peer = new CodexJsonRpcPeer();
    try {
        recordSessionBinding(sessionId, { path: directory, flavor: 'codex' } as Metadata);
        const { sessionId: threadId } = await backend.startSession();
        await backend.getGoal();
        await backend.dispose();
        const binding = readSessionBinding(sessionId)!;
        expect(binding.emptyNativeSessionIds).toContain(threadId);

        await peer.spawn('npx', ['-y', '@openai/codex@0.145.0', 'app-server'], { cwd: directory, env: { CODEX_HOME: codexHome } });
        await peer.request('initialize', { clientInfo: { name: 'happy-test', version: '1.0.0' } });
        peer.notify('initialized', {});
        await expect(peer.request('thread/archive', { threadId })).rejects.toThrow(/no rollout found/i);
        await peer.close();

        await expect(syncCodexArchive(binding, true)).resolves.toBeUndefined();
        await expect(syncCodexArchive(binding, true)).resolves.toBeUndefined();
    } finally {
        await backend.dispose();
        await peer.close();
        if (previousHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previousHome;
        for (const suffix of ['.json', '.json.stop']) {
            rmSync(join(configuration.happyHomeDir, 'session-bindings', `${sessionId}${suffix}`), { force: true });
        }
        rmSync(directory, { recursive: true, force: true });
    }
}, 120_000);
