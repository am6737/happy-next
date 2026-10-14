import type { Session } from '@/sync/storageTypes';

/**
 * Whether the session can be forked (or resumed) on its machine: it needs the agent's own session ID,
 * and a shared session points at the owner's machine, which the viewer cannot fork on. Archiving does
 * not matter — Claude, Gemini and Qoder history stays in place, and the CLI unarchives native Codex
 * history only for the fork (`borrowArchived`) and archives it again.
 */
export function canForkSession(session: Session | undefined): boolean {
    const metadata = session?.metadata;
    return !!session && !session.accessLevel && !!metadata?.machineId && !!metadata.path && !!(
        metadata.claudeSessionId || metadata.flavor === 'gemini' || metadata.codexSessionId || metadata.qoderSessionId
    );
}

export function canEditSession(session: Session): boolean {
    // Heartbeat expiry also clears active; only an explicit archive is read-only.
    return session.accessLevel !== 'view' && session.metadata?.lifecycleState !== 'archived';
}

export function canArchiveSession(session: Session, isConnected: boolean): boolean {
    if (session.accessLevel) return false;
    if (session.metadata?.lifecycleState === 'archived') return false;
    // Native archive can fail after the session process has already stopped.
    return isConnected || (!session.active && session.metadata?.flavor === 'codex' && !!session.metadata.machineId);
}
