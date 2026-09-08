import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const home = vi.hoisted(() => ({ value: '' }));
vi.mock('@/configuration', () => ({ configuration: { get happyHomeDir() { return home.value; } } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/codex/appserver/CodexJsonRpcPeer', () => ({ CodexJsonRpcPeer: vi.fn() }));
import { isBindingRunning, processIdentity, processStart, readSessionBinding, readStopSnapshot, writeStopSnapshot, recordSessionBinding, type SessionBinding } from './sessionBinding';
import { stopBoundSession } from './executeSessionArchive';
import type { Metadata } from '@/api/types';

describe.skipIf(process.platform === 'win32')('verified session process binding', () => {
    const children: ChildProcess[] = [];
    afterEach(() => {
        vi.unstubAllEnvs();
        for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        if (home.value) rmSync(home.value, { recursive: true, force: true });
    });

    async function fixture() {
        home.value = mkdtempSync(join(tmpdir(), 'happy-archive-test-'));
        recordSessionBinding('isolated', { path: home.value, flavor: 'codex', codexSessionId: 'native-1' } as Metadata);
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        children.push(child);
        await once(child, 'spawn');
        const binding: SessionBinding = { ...readSessionBinding('isolated')!, pid: child.pid!, identity: processIdentity(child.pid!)! };
        return { child, binding };
    }

    it('stops an isolated real process and persists a retry snapshot', async () => {
        const { child, binding } = await fixture();
        expect(isBindingRunning(binding)).toBe(true);
        await stopBoundSession(binding);
        expect(isBindingRunning(binding)).toBe(false);
        expect(child.signalCode).toBe('SIGTERM');
        const snapshot = readStopSnapshot(binding).find(entry => entry.pid === binding.pid);
        expect(processStart(snapshot!.identity)).toBe(processStart(binding.identity));
        await stopBoundSession(binding);
    });

    it('never signals a reused PID with a different identity', async () => {
        const { binding } = await fixture();
        await stopBoundSession({ ...binding, identity: 'different-process S' });
        expect(isBindingRunning(binding)).toBe(true);
    });

    it('retains all native IDs belonging to one Happy session', () => {
        home.value = mkdtempSync(join(tmpdir(), 'happy-archive-test-'));
        for (const id of ['native-1', 'native-2', 'native-1']) {
            recordSessionBinding('isolated', { path: home.value, flavor: 'codex', codexSessionId: id } as Metadata);
        }
        expect(readSessionBinding('isolated')?.nativeSessionIds).toEqual(['native-1', 'native-2']);
    });
    it('records an absolute Codex home even when the environment uses a relative path', () => {
        home.value = mkdtempSync(join(tmpdir(), 'happy-archive-home-'));
        vi.stubEnv('CODEX_HOME', '../codex-history');
        recordSessionBinding('isolated', { path: home.value, flavor: 'codex', codexSessionId: 'native-1' } as Metadata);
        expect(readSessionBinding('isolated')?.codexHome).toBe(resolve('../codex-history'));
    });
    it.each(['claude', 'gemini'])('does not record %s bindings for native Codex archive', flavor => {
        home.value = mkdtempSync(join(tmpdir(), 'happy-archive-home-'));
        recordSessionBinding('unrelated', { path: home.value, flavor } as Metadata);
        expect(readSessionBinding('unrelated')).toBeNull();
    });
    it('stops an orphaned native helper from the persisted snapshot before reconciliation', async () => {
        const { binding } = await fixture();
        const deadWrapper = { ...binding, identity: 'previous-wrapper S' };
        writeStopSnapshot(deadWrapper, [{ pid: binding.pid, identity: binding.identity }]);
        await stopBoundSession(deadWrapper);
        expect(isBindingRunning(binding)).toBe(false);
    });
});
