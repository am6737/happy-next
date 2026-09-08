import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { configuration } from '@/configuration';
import { CodexJsonRpcPeer } from '@/codex/appserver/CodexJsonRpcPeer';
import { CODEX_PACKAGE } from '@/codex/package';
import { readSessionBinding, listSessionBindings, isBindingRunning, processIdentity, readStopSnapshot, writeStopSnapshot, type SessionBinding } from './sessionBinding';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function stopBoundSession(binding: SessionBinding, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const roots = [binding, ...binding.processes, ...readStopSnapshot(binding)].filter(isBindingRunning);
    if (!roots.length) return;
    // Snapshot children before stopping the parent: detached backend groups can outlive it.
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 })
        .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const descendants = new Set(roots.map(root => root.pid));
    let changed = true;
    while (changed) {
        changed = false;
        for (const [pid, parent] of rows) if (descendants.has(parent) && !descendants.has(pid)) {
            descendants.add(pid); changed = true;
        }
    }
    const processes = [...descendants].flatMap(pid => {
        const identity = roots.find(root => root.pid === pid)?.identity ?? processIdentity(pid);
        return identity ? [{ pid, identity }] : [];
    });
    writeStopSnapshot(binding, processes);
    const sendSignal = (sig: NodeJS.Signals) => {
        signal?.throwIfAborted();
        for (const process of processes) if (isBindingRunning(process)) {
            try { global.process.kill(process.pid, sig); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
    };
    // Give the Happy wrapper time to flush and shut down its backends gracefully.
    if (isBindingRunning(binding)) {
        process.kill(binding.pid, 'SIGTERM');
        for (let i = 0; i < 40 && processes.some(isBindingRunning); i++) await delay(250);
    }
    sendSignal('SIGTERM');
    for (let i = 0; i < 8 && processes.some(isBindingRunning); i++) await delay(250);
    sendSignal('SIGKILL');
    for (let i = 0; i < 8 && processes.some(isBindingRunning); i++) await delay(250);
    if (processes.some(isBindingRunning)) throw new Error('stop-not-confirmed');
}

export async function syncCodexArchive(binding: SessionBinding, archived: boolean, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!binding.nativeSessionIds.length) return;
    const peer = new CodexJsonRpcPeer();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 75_000);
    try {
        let cwd = binding.cwd;
        try {
            if (!statSync(cwd).isDirectory()) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
        } catch (error) {
            if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
            cwd = join(configuration.happyHomeDir, 'archive-runtime');
            mkdirSync(cwd, { recursive: true, mode: 0o700 });
        }
        await peer.spawn('npx', ['-y', binding.codexPackage ?? CODEX_PACKAGE, 'app-server'], {
            cwd,
            signal: controller.signal,
            env: { CODEX_HOME: binding.codexHome ? resolve(binding.cwd, binding.codexHome) : join(homedir(), '.codex') },
        });
        // Persist the native helper before issuing side effects, so a replacement daemon
        // can stop an orphaned helper before reconciling the same threads.
        if (peer.pid) {
            const identity = processIdentity(peer.pid);
            if (!identity) throw new Error('process-verification-unsupported');
            writeStopSnapshot(binding, [...readStopSnapshot(binding), { pid: peer.pid, identity }]);
        }
        await peer.request('initialize', { clientInfo: { name: 'happy-archive', version: '1.0.0' } }, 15_000);
        peer.notify('initialized', {});
        // No resume/start: archive existing persisted threads without creating a new conversation.
        for (const threadId of binding.nativeSessionIds) {
            signal?.throwIfAborted();
            // Check the target state so retries after a lost acknowledgement are safe.
            let cursor: string | null | undefined;
            let found = false;
            do {
                const response = await peer.request<{ data: Array<{ id: string }>; nextCursor?: string | null }>(
                    'thread/list', { archived, limit: 100, cursor }, 15_000,
                );
                found = response.data.some(thread => thread.id === threadId);
                cursor = response.nextCursor;
            } while (!found && cursor);
            if (!found) {
                await peer.request(archived ? 'thread/archive' : 'thread/unarchive', { threadId }, 20_000);
            }
        }
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        await peer.close();
    }
}

export type CodexArchiveResult = { success: boolean; stopped: boolean; error?: string };

export async function executeSessionArchive(request: { sessionId: string; nativeSessionId?: string }, signal?: AbortSignal): Promise<CodexArchiveResult> {
    let stopped = false;
    try {
        const binding = readSessionBinding(request.sessionId);
        // Older CLIs have no durable process identity. Never kill a possibly reused PID.
        if (!binding) throw new Error('session-identity-unavailable');
        if (binding.provider !== 'codex') throw new Error('session-provider-mismatch');
        if (request.nativeSessionId && !binding.nativeSessionIds.includes(request.nativeSessionId)) {
            throw new Error('native-session-id-unavailable');
        }
        const conflict = listSessionBindings().some(other => other.sessionId !== binding.sessionId &&
            other.provider === binding.provider && other.nativeSessionIds.some(id => binding.nativeSessionIds.includes(id)) && isBindingRunning(other));
        if (conflict) throw new Error('native-session-in-use');
        await stopBoundSession(binding, signal);
        stopped = true;
        // The final turn can persist another native thread ID during shutdown.
        const latest = readSessionBinding(request.sessionId) ?? binding;
        if (latest.provider !== 'codex') throw new Error('session-provider-mismatch');
        if (isBindingRunning(latest)) throw new Error('native-session-in-use');
        if (binding.nativeSessionIds.some(id => !latest.nativeSessionIds.includes(id))) throw new Error('native-session-id-unavailable');
        const inUse = listSessionBindings().some(other => other.sessionId !== binding.sessionId &&
            other.provider === 'codex' && other.nativeSessionIds.some(id => latest.nativeSessionIds.includes(id)) && isBindingRunning(other));
        if (inUse) throw new Error('native-session-in-use');
        await syncCodexArchive(latest, true, signal);
        return { success: true, stopped };
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const known = ['session-identity-unavailable', 'session-provider-mismatch', 'native-session-in-use',
            'native-session-id-unavailable', 'stop-not-confirmed', 'process-verification-unsupported'];
        return { success: false, stopped,
            error: known.includes(message) ? message : stopped ? 'native-archive-failed' : 'stop-failed' };
    }
}

export async function restoreCodexSession(nativeSessionId: string): Promise<string | undefined> {
    const bindings = listSessionBindings().filter(binding => binding.provider === 'codex' && binding.nativeSessionIds.includes(nativeSessionId));
    if (!bindings.length) throw new Error('session-identity-unavailable');
    if (bindings.some(isBindingRunning)) throw new Error('native-session-in-use');
    const binding = bindings[0];
    await stopBoundSession(binding);
    await syncCodexArchive({ ...binding, nativeSessionIds: [nativeSessionId] }, false);
    return binding.codexHome;
}
