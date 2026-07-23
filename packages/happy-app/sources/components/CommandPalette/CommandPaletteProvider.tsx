import React, { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { Command } from './types';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { OPEN_COMMAND_PALETTE_EVENT } from './events';
import { isTauriDesktop } from '@/utils/tauri';
import { useModal } from '@/modal';

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { logout, isAuthenticated } = useAuth();
    const sessions = storage(useShallow((state) => state.sessions));
    const commandPaletteEnabled = storage(useShallow((state) => state.localSettings.commandPaletteEnabled));
    const navigateToSession = useNavigateToSession();
    const { state: modalState, hideModal } = useModal();
    const currentModal = modalState.modals[modalState.modals.length - 1];

    // Define available commands
    const commands = useMemo((): Command[] => {
        const cmds: Command[] = [
            // Navigation commands
            {
                id: 'new-session',
                title: 'New Session',
                subtitle: 'Start a new chat session',
                icon: 'add-circle-outline',
                category: 'Sessions',
                shortcut: '⌘N',
                action: () => {
                    router.push('/new');
                }
            },
            {
                id: 'sessions',
                title: 'View All Sessions',
                subtitle: 'Browse your chat history',
                icon: 'chatbubbles-outline',
                category: 'Sessions',
                action: () => {
                    router.push('/');
                }
            },
            {
                id: 'settings',
                title: 'Settings',
                subtitle: 'Configure your preferences',
                icon: 'settings-outline',
                category: 'Navigation',
                shortcut: '⌘,',
                action: () => {
                    router.push('/settings');
                }
            },
            {
                id: 'account',
                title: 'Account',
                subtitle: 'Manage your account',
                icon: 'person-circle-outline',
                category: 'Navigation',
                action: () => {
                    router.push('/settings/account');
                }
            },
            {
                id: 'connect',
                title: 'Connect Device',
                subtitle: 'Connect a new device via web',
                icon: 'link-outline',
                category: 'Navigation',
                action: () => {
                    router.push('/terminal/connect');
                }
            },
        ];

        // Add session-specific commands
        const recentSessions = Object.values(sessions)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5);

        recentSessions.forEach(session => {
            const sessionName = session.metadata?.name || `Session ${session.id.slice(0, 6)}`;
            cmds.push({
                id: `session-${session.id}`,
                title: sessionName,
                subtitle: session.metadata?.path || 'Switch to session',
                icon: 'time-outline',
                category: 'Recent Sessions',
                action: () => {
                    navigateToSession(session.id);
                }
            });
        });

        // System commands
        cmds.push({
            id: 'sign-out',
            title: 'Sign Out',
            subtitle: 'Sign out of your account',
            icon: 'log-out-outline',
            category: 'System',
            action: async () => {
                await logout();
            }
        });

        // Dev commands (if in development)
        if (__DEV__) {
            cmds.push({
                id: 'dev-menu',
                title: 'Developer Menu',
                subtitle: 'Access developer tools',
                icon: 'code-slash-outline',
                category: 'Developer',
                action: () => {
                    router.push('/dev');
                }
            });
        }

        return cmds;
    }, [router, logout, sessions]);

    const openCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web') return;

        Modal.show({
            component: CommandPalette,
            props: {
                commands,
            }
        } as any);
    }, [commands]);

    const showCommandPalette = useCallback(() => {
        if (!isTauriDesktop() && !commandPaletteEnabled) return;
        openCommandPalette();
    }, [commandPaletteEnabled, openCommandPalette]);

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
        enableBrowserSearch: commandPaletteEnabled,
        onSearch: showCommandPalette,
        onNewSession: () => router.push('/new'),
        onSettings: () => router.navigate('/settings'),
        onSessions: () => router.navigate('/'),
        onInbox: () => router.navigate('/(app)/inbox'),
        onDootask: () => router.navigate('/(app)/dootask'),
        onBack: () => window.history.back(),
        onForward: () => window.history.forward(),
        onEscape: currentModal ? closeTopModal : undefined,
    }), [commandPaletteEnabled, currentModal, closeTopModal, isAuthenticated, router, showCommandPalette]);

    useGlobalKeyboard(shortcutHandlers);

    return <>{children}</>;
}
