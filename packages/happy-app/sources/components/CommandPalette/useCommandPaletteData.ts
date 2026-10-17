import { useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { Modal } from '@/modal';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { sortMachines } from '@/utils/machineOrder';
import { t } from '@/text';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { compareSessionsByLastMessage } from '@/utils/sessionLastMessageAt';
import { isMachineOnline } from '@/utils/machineUtils';
import { mergeMessageSearchMatches, searchMachineMessages } from '@/sync/machineMessageSearch';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';
import { buildCommandPaletteCommands } from './commandPaletteCommands';
import type { Command, MessageSearch } from './types';

function sessionIdFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/session\/([^/]+)/);
    if (!match || ['recent', 'history', 'claude'].includes(match[1])) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

// What the command palette and the phone's search page search: the commands (sessions, machines,
// pages, actions) and the message search. While not `active` the commands stay as they were.
export function useCommandPaletteData(active: boolean): { commands: Command[]; searchMessages: MessageSearch } {
    const router = useRouter();
    const pathname = usePathname();
    const { logout } = useAuth();
    const commandSource = storage(useShallow((state) => ({
        sessions: state.sessions,
        sharedSessions: state.sharedSessions,
        machines: state.machines,
        machineOrder: state.settings.machineOrder,
        drafts: state.drafts,
        dootaskConnected: !!state.dootaskProfile,
        experimentsEnabled: state.settings.experiments,
        developerEnabled: __DEV__ || state.localSettings.devModeEnabled,
    })));
    const commandState = useMemo(() => ({
        sessions: Object.values({ ...commandSource.sharedSessions, ...commandSource.sessions }),
        machines: sortMachines(Object.values(commandSource.machines).filter((machine) => machine.active), commandSource.machineOrder),
        drafts: commandSource.drafts,
        dootaskConnected: commandSource.dootaskConnected,
        experimentsEnabled: commandSource.experimentsEnabled,
        developerEnabled: commandSource.developerEnabled,
    }), [commandSource]);
    const navigateToSession = useNavigateToSession();

    // Read through a ref so the commands don't depend on these: navigateToSession is new on every render,
    // which rebuilt every command — and re-rendered every palette row — each time this hook's owner rendered
    const actionsRef = useRef({ router, navigateToSession, logout });
    actionsRef.current = { router, navigateToSession, logout };

    // Frozen while inactive: sessions update every few seconds, and a hidden palette
    // re-rendering all its rows for each update stalls the whole app. It catches up when shown again
    const lastCommandsRef = useRef<Command[] | null>(null);
    const commands = useMemo(() => {
        if (!active && lastCommandsRef.current) return lastCommandsRef.current;
        return buildCommandPaletteCommands({
            ...commandState,
            desktopPlatform: getDesktopPlatform(),
            currentSessionId: sessionIdFromPath(pathname),
            navigate: (path) => actionsRef.current.router.push(path as any),
            navigateToSession: (sessionId) => actionsRef.current.navigateToSession(sessionId),
            logout: async () => {
                const confirmed = await Modal.confirm(
                    t('settingsAccount.logout'),
                    t('settingsAccount.logoutConfirm'),
                    { confirmText: t('common.logout'), destructive: true },
                );
                if (confirmed) {
                    try {
                        await actionsRef.current.logout();
                    } catch {
                        Modal.alert(t('common.error'), t('errors.networkError'));
                    }
                }
            },
        });
    }, [commandState, active, pathname]);
    lastCommandsRef.current = commands;

    // Stable across session updates, which are frequent: a new function would rerun the open palette's message search
    const sessionsRef = useRef(commandState.sessions);
    sessionsRef.current = commandState.sessions;
    // The local message cache and every online machine's message archive, merged as each answers
    const searchMessages = useCallback<MessageSearch>(async (query, onMatches) => {
        const sessionIds = [...sessionsRef.current]
            .sort(compareSessionsByLastMessage)
            .map((session) => session.id);
        const machineIds = Object.values(storage.getState().machines)
            .filter(isMachineOnline)
            .map((machine) => machine.id);
        const sources: CachedMessageSearchMatch[][] = [];
        const publish = (matches: CachedMessageSearchMatch[]) => {
            sources.push(matches);
            onMatches(mergeMessageSearchMatches(sources, sessionIds));
        };
        await Promise.all([
            sync.searchCachedMessages(query, sessionIds).then(publish),
            ...machineIds.map((machineId) => searchMachineMessages(machineId, query).then(publish)),
        ]);
    }, []);

    return { commands, searchMessages };
}
