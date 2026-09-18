import { Session } from '@/sync/storageTypes';
import { canArchiveSession } from '@/utils/sessionLifecycle';

export type SessionQuickActionKind =
    | 'details'
    | 'renameSession'
    | 'newSession'
    | 'delegationHistory'
    | 'manageSharing'
    | 'leaveSharedSession'
    | 'viewMachine'
    | 'forkSession'
    | 'archiveSession'
    | 'deleteSession';

export function getSessionQuickActionKinds({
    session,
    hasOrchestratorRuns,
    isConnected,
}: {
    session: Session;
    hasOrchestratorRuns: boolean;
    isConnected: boolean;
}): SessionQuickActionKind[] {
    const isOwner = !session.accessLevel;
    const isAdmin = isOwner || session.accessLevel === 'admin';
    const isForkable = !!(
        session.metadata?.machineId
        && session.metadata?.path
        && (session.metadata?.claudeSessionId || session.metadata?.flavor === 'gemini' || session.metadata?.codexSessionId)
    );

    const actions: SessionQuickActionKind[] = ['details'];
    // Only the owner can write session metadata; shared users get a read-only title.
    if (isOwner) actions.push('renameSession');
    // Starting a session in this directory spawns it on the session's machine, which a session
    // shared with me does not grant — it points at the owner's machine and directory.
    if (isOwner) actions.push('newSession');
    if (hasOrchestratorRuns) actions.push('delegationHistory');
    if (isAdmin) actions.push('manageSharing');
    if (!isOwner) actions.push('leaveSharedSession');
    if (isOwner && session.metadata?.machineId) actions.push('viewMachine');
    if (isOwner && isForkable) actions.push('forkSession');
    if (canArchiveSession(session, isConnected)) actions.push('archiveSession');
    if (isOwner && !isConnected && !session.active) actions.push('deleteSession');
    return actions;
}
