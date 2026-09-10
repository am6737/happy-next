import type { ActionMenuItem } from '@/components/ActionMenu';
import type { Session } from '@/sync/storageTypes';

const fileMenuOrder = [
    'copyRelativePath', 'copyFileName', 'edit', 'history',
    'share', 'download', 'reload', 'delete',
] as const;

export function buildFileMenuItems(
    actions: Partial<Record<typeof fileMenuOrder[number], ActionMenuItem>>
): ActionMenuItem[] {
    return fileMenuOrder.flatMap((key) => actions[key] ? [actions[key]!] : []);
}

export function canMutateFile(
    session: Pick<Session, 'accessLevel' | 'metadata'> | null,
    version: 'worktree' | 'index' | 'commit',
    exists: boolean
): boolean {
    // Shared-session file writes and shell deletion both require admin, not edit.
    return !!session && exists && version === 'worktree' &&
        session.metadata?.lifecycleState !== 'archived' &&
        (!session.accessLevel || session.accessLevel === 'admin');
}

export function canShareFileText(text: string, platform: string, webShareAvailable: boolean): boolean {
    return text.length > 0 && (platform !== 'web' || webShareAvailable);
}
