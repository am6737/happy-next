import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { configuration } from '@/configuration';
import type { Metadata } from '@/api/types';
import { logger } from '@/ui/logger';
import { CODEX_PACKAGE } from '@/codex/package';

const BindingSchema = z.object({
    sessionId: z.string(), provider: z.enum(['claude', 'codex', 'gemini']),
    cwd: z.string(), pid: z.number(), identity: z.string(),
    nativeSessionIds: z.array(z.string()), codexHome: z.string().optional(),
    codexPackage: z.string().optional(),
    processes: z.array(z.object({ pid: z.number(), identity: z.string() })).default([]),
});
export type SessionBinding = z.infer<typeof BindingSchema>;
const directory = () => join(configuration.happyHomeDir, 'session-bindings');
const file = (id: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('invalid-session-id');
    return join(directory(), `${id}.json`);
};

export function processIdentity(pid: number): string | null {
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid-process-id');
    if (process.platform === 'win32') throw new Error('process-verification-unsupported');
    if (process.platform === 'linux') {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
            return `${boot}:${fields[19]} ${fields[0]}`;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
    }
    try {
        return execFileSync('ps', ['-p', String(pid), '-o', 'lstart=,stat='], { encoding: 'utf8', timeout: 5000 }).trim() || null;
    } catch (error) {
        if ((error as { status?: number }).status === 1) return null;
        throw error;
    }
}

export function processStart(identity: string): string {
    return identity.replace(/\s+\S+$/, '');
}

export function isBindingRunning(binding: Pick<SessionBinding, 'pid' | 'identity'>): boolean {
    const identity = processIdentity(binding.pid);
    return !!identity && !/\sZ\S*$/.test(identity) && processStart(identity) === processStart(binding.identity);
}

export function readSessionBinding(id: string): SessionBinding | null {
    try { return BindingSchema.parse(JSON.parse(readFileSync(file(id), 'utf8'))); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

export function listSessionBindings(): SessionBinding[] {
    try { return readdirSync(directory()).filter(name => name.endsWith('.json')).flatMap(name => {
        const binding = readSessionBinding(name.slice(0, -5));
        return binding ? [binding] : [];
    }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

const StopSnapshotSchema = z.object({ identity: z.string(), processes: z.array(z.object({ pid: z.number(), identity: z.string() })) });
export function readStopSnapshot(binding: SessionBinding) {
    try {
        const snapshot = StopSnapshotSchema.parse(JSON.parse(readFileSync(`${file(binding.sessionId)}.stop`, 'utf8')));
        return processStart(snapshot.identity) === processStart(binding.identity) ? snapshot.processes : [];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

export function writeStopSnapshot(binding: SessionBinding, processes: Array<{ pid: number; identity: string }>) {
    const target = `${file(binding.sessionId)}.stop`;
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ identity: binding.identity, processes }), { mode: 0o600 });
    renameSync(temporary, target);
}

let ownIdentity: string | null = null;
let currentSession: { id: string; metadata: Metadata } | null = null;
const managedProcesses = new Map<number, string>();

export function recordManagedProcess(pid: number | undefined): void {
    if (!pid || !currentSession) return;
    try {
        const identity = processIdentity(pid);
        if (identity) managedProcesses.set(pid, identity);
        recordSessionBinding(currentSession.id, currentSession.metadata);
    } catch (error) { logger.debug('[SessionBinding] Could not record child process', error); }
}

export function recordSessionBinding(sessionId: string, metadata: Metadata): void {
    if (metadata.flavor !== 'codex') return;
    currentSession = { id: sessionId, metadata };
    try {
        const provider = 'codex';
        ownIdentity ??= processIdentity(process.pid);
        if (!ownIdentity) return;
        const previous = readSessionBinding(sessionId);
        const nativeId = metadata.codexSessionId;
        const binding: SessionBinding = {
            sessionId, provider, cwd: metadata.path, pid: process.pid, identity: ownIdentity,
            nativeSessionIds: [...new Set([...(previous?.nativeSessionIds ?? []), ...(nativeId ? [nativeId] : [])])],
            processes: [...managedProcesses].map(([pid, identity]) => ({ pid, identity })),
            codexPackage: CODEX_PACKAGE,
            codexHome: resolve(process.env.CODEX_HOME || join(homedir(), '.codex')),
        };
        if (JSON.stringify(binding) === JSON.stringify(previous)) return;
        mkdirSync(directory(), { recursive: true, mode: 0o700 });
        const target = file(sessionId);
        const temporary = `${target}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(binding), { mode: 0o600 });
        renameSync(temporary, target);
    } catch (error) {
        logger.debug('[SessionBinding] Could not persist session identity', error);
    }
}
