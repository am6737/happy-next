// The menu a long press on either of the chat header's two buttons opens: what a tap on each does
// (the session's details; its delegations or a new session here) and the session's CLI upgrade
// while one is offered, then a new session elsewhere, a terminal on the session's machine and
// archiving it. Rows the session does not allow are left
// out, and with only the details left there is no menu (`items` is null) — the avatar's tap is it.
//
// `archiveMenu` is the archive's worktree choice; the caller renders it.
import * as React from 'react';
import { useRouter } from 'expo-router';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { useDismissToHomeIfViewing } from '@/hooks/useDismissToHome';
import { useOpenTerminal } from '@/hooks/useOpenTerminal';
import { useSessionArchive } from '@/hooks/useSessionArchive';
import { useSessionUpgrade } from '@/hooks/useSessionUpgrade';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { canArchiveSession } from '@/utils/sessionLifecycle';

export function useChatHeaderMenu(session: Session | null | undefined, actions: {
    onDetails?: () => void;
    /** Set while the session has delegations. */
    onOpenRuns?: () => void;
    /** Set where a new session can start on this one's machine (not a session shared with me). */
    onNewSessionHere?: () => void;
    /** The CLI version the session can be upgraded to, while it can. */
    cliUpgrade?: string | null;
}) {
    const { onDetails, onOpenRuns, onNewSessionHere, cliUpgrade } = actions;
    const router = useRouter();
    const sessionRef = React.useRef(session);
    sessionRef.current = session;

    const { openSession } = useOpenTerminal();
    const handleOpenTerminal = React.useCallback(() => {
        if (sessionRef.current) openSession(sessionRef.current);
    }, [openSession]);
    const handleNewSessionElsewhere = React.useCallback(() => router.push('/new'), [router]);
    // Leaving the chat once the session is archived, as archiving from its row does — after the
    // request rather than before, so a failure is still shown here.
    const dismissIfViewing = useDismissToHomeIfViewing(session?.id ?? '');
    const { archive, archiveMenu } = useSessionArchive(session, { onArchived: dismissIfViewing });
    const { upgrade } = useSessionUpgrade(session);
    const handleUpgrade = React.useCallback(() => void upgrade(), [upgrade]);

    const canOpenTerminal = !!session && !session.accessLevel && !!session.metadata?.machineId;
    const canArchive = !!session && canArchiveSession(session, session.presence === 'online');
    const items = React.useMemo(() => {
        const items: ActionMenuItem[] = [];
        if (onDetails) {
            items.push({ label: t('sessionInfo.title'), icon: { ionicon: 'information-circle-outline', sfSymbol: 'info.circle' }, onPress: onDetails });
        }
        if (onOpenRuns) {
            items.push({ label: t('sessionInfo.delegationHistory'), icon: { ionicon: 'layers-outline', sfSymbol: 'square.3.layers.3d' }, onPress: onOpenRuns });
        }
        if (cliUpgrade) {
            items.push({ label: t('sessionInfo.menuUpgradeSession', { version: cliUpgrade }), icon: { ionicon: 'arrow-up-circle-outline', sfSymbol: 'arrow.up.circle' }, onPress: handleUpgrade });
        }
        if (onNewSessionHere) {
            items.push(
                { label: t('newSession.menuNewSessionHere'), icon: { ionicon: 'folder-open-outline', sfSymbol: 'folder.badge.plus' }, onPress: onNewSessionHere, startsSection: true },
                { label: t('newSession.menuNewSessionElsewhere'), icon: { ionicon: 'chatbubble-outline', sfSymbol: 'bubble.left' }, onPress: handleNewSessionElsewhere },
            );
        }
        if (canOpenTerminal) {
            items.push({ label: t('sessionScope.openTerminal'), icon: { ionicon: 'terminal-outline', sfSymbol: 'apple.terminal' }, onPress: handleOpenTerminal, startsSection: !onNewSessionHere });
        }
        if (canArchive) {
            items.push({ label: t('sessionInfo.archiveSession'), icon: { ionicon: 'archive-outline', sfSymbol: 'archivebox' }, destructive: true, onPress: archive, startsSection: true });
        }
        return items.length > 1 ? items : null;
    }, [onDetails, onOpenRuns, cliUpgrade, handleUpgrade, onNewSessionHere, handleNewSessionElsewhere, canOpenTerminal, handleOpenTerminal, canArchive, archive]);

    return { items, archiveMenu };
}
