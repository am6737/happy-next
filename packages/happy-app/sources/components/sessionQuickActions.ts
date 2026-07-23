import { Session } from '@/sync/storageTypes';

export type SessionQuickActionKind =
    | 'details'
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

    const actions: SessionQuickActionKind[] = ['details', 'newSession'];
    if (hasOrchestratorRuns) actions.push('delegationHistory');
    if (isAdmin) actions.push('manageSharing');
    if (!isOwner) actions.push('leaveSharedSession');
    if (isOwner && session.metadata?.machineId) actions.push('viewMachine');
    if (isOwner && isForkable) actions.push('forkSession');
    if (isOwner && isConnected) actions.push('archiveSession');
    if (isOwner && !isConnected && !session.active) actions.push('deleteSession');
    return actions;
}
