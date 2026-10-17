import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { CommandPaletteModal } from './CommandPaletteModal';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import { useAuth } from '@/auth/AuthContext';
import { OPEN_COMMAND_PALETTE_EVENT } from './events';
import { useModal } from '@/modal';
import { useCommandPaletteData } from './useCommandPaletteData';

const CommandPaletteContext = createContext<() => void>(() => {});

export function useOpenCommandPalette() {
    return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const { state: modalState, hideModal } = useModal();
    const currentModal = modalState.modals[modalState.modals.length - 1];
    // Mounted on first open and then only hidden, so reopening shows the palette as it was left.
    // Esc on an empty query remounts it (new key) so the next open starts fresh
    const [palette, setPalette] = useState<{ visible: boolean; key: number } | null>(null);

    const isPaletteVisible = !!palette?.visible;

    const { commands, searchMessages } = useCommandPaletteData(isPaletteVisible);

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
                        searchMessages={searchMessages}
                        onClose={hidePalette}
                        onDismiss={dismissPalette}
                    />
                </CommandPaletteModal>
            )}
        </CommandPaletteContext.Provider>
    );
}
