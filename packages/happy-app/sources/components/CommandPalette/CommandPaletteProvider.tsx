import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { CommandPaletteModal } from './CommandPaletteModal';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { OPEN_COMMAND_PALETTE_EVENT } from './events';
import { useModal } from '@/modal';
import { buildCommandPaletteCommands } from './commandPaletteCommands';
import type { Command } from './types';
import { t } from '@/text';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { compareSessionsByLastMessage } from '@/utils/sessionLastMessageAt';

const CommandPaletteContext = createContext<() => void>(() => {});

export function useOpenCommandPalette() {
    return useContext(CommandPaletteContext);
}

function sessionIdFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/session\/([^/]+)/);
    if (!match || ['recent', 'history', 'claude'].includes(match[1])) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { logout, isAuthenticated } = useAuth();
    const commandSource = storage(useShallow((state) => ({
        sessions: state.sessions,
        sharedSessions: state.sharedSessions,
        machines: state.machines,
        drafts: state.drafts,
        dootaskConnected: !!state.dootaskProfile,
        experimentsEnabled: state.settings.experiments,
        developerEnabled: __DEV__ || state.localSettings.devModeEnabled,
    })));
    const commandState = useMemo(() => ({
        sessions: Object.values({ ...commandSource.sharedSessions, ...commandSource.sessions }),
        machines: Object.values(commandSource.machines).filter((machine) => machine.active),
        drafts: commandSource.drafts,
        dootaskConnected: commandSource.dootaskConnected,
        experimentsEnabled: commandSource.experimentsEnabled,
        developerEnabled: commandSource.developerEnabled,
    }), [commandSource]);
    const navigateToSession = useNavigateToSession();
    const { state: modalState, hideModal } = useModal();
    const currentModal = modalState.modals[modalState.modals.length - 1];
    // Mounted on first open and then only hidden, so reopening shows the palette as it was left.
    // Esc on an empty query remounts it (new key) so the next open starts fresh
    const [palette, setPalette] = useState<{ visible: boolean; key: number } | null>(null);

    const isPaletteVisible = !!palette?.visible;

    // Read through a ref so the commands don't depend on these: navigateToSession is new on every render,
    // which rebuilt every command — and re-rendered every palette row — each time this provider rendered
    const actionsRef = useRef({ router, navigateToSession, logout });
    actionsRef.current = { router, navigateToSession, logout };

    // Frozen while the palette is hidden: sessions update every few seconds, and a hidden palette
    // re-rendering all its rows for each update stalls the whole app. It catches up when shown again
    const lastCommandsRef = useRef<Command[] | null>(null);
    const commands = useMemo(() => {
        if (!isPaletteVisible && lastCommandsRef.current) return lastCommandsRef.current;
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
    }, [commandState, isPaletteVisible, pathname]);
    lastCommandsRef.current = commands;

    // Stable across session updates, which are frequent: a new function would rerun the open palette's message search
    const sessionsRef = useRef(commandState.sessions);
    sessionsRef.current = commandState.sessions;
    const searchCachedMessages = useCallback((query: string) => {
        const sessionIds = [...sessionsRef.current]
            .sort(compareSessionsByLastMessage)
            .map((session) => session.id);
        return sync.searchCachedMessages(query, sessionIds);
    }, []);

    const openCommandPalette = useCallback(() => {
        setPalette((current) => ({ visible: !current?.visible, key: current?.key ?? 0 }));
    }, []);

    const hidePalette = useCallback(() => {
        setPalette((current) => current && { ...current, visible: false });
    }, []);

    const dismissPalette = useCallback(() => {
        setPalette((current) => current && { visible: false, key: current.key + 1 });
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette);
        return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette);
    }, [openCommandPalette]);

    const closeTopModal = useCallback(() => {
        if (!currentModal) return;
        if (currentModal.type === 'confirm') {
            Modal.resolveConfirm(currentModal.id, false);
        } else if (currentModal.type === 'prompt') {
            Modal.resolvePrompt(currentModal.id, null);
        }
        hideModal(currentModal.id);
    }, [currentModal, hideModal]);

    const shortcutHandlers = useMemo(() => ({
        enabled: isAuthenticated,
        onSearch: openCommandPalette,
        onNewSession: () => router.push('/new'),
        onSettings: () => router.navigate('/settings'),
        onSessions: () => router.navigate('/'),
        onInbox: () => router.navigate('/(app)/inbox'),
        onDootask: () => router.navigate('/(app)/dootask'),
        onBack: () => window.history.back(),
        onForward: () => window.history.forward(),
        onEscape: currentModal ? closeTopModal : undefined,
    }), [currentModal, closeTopModal, isAuthenticated, openCommandPalette, router]);

    useGlobalKeyboard(shortcutHandlers);

    return (
        <CommandPaletteContext.Provider value={openCommandPalette}>
            {children}
            {palette && isAuthenticated && (
                <CommandPaletteModal visible={palette.visible} onHide={hidePalette}>
                    <CommandPalette
                        key={palette.key}
                        visible={palette.visible}
                        escapeEnabled={!currentModal}
                        commands={commands}
                        searchCachedMessages={searchCachedMessages}
                        onClose={hidePalette}
                        onDismiss={dismissPalette}
                    />
                </CommandPaletteModal>
            )}
        </CommandPaletteContext.Provider>
    );
}
