import React from 'react';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { useOrchestratorHasRuns, useSessionMarkerColor } from '@/sync/storage';
import { getSessionName, useSessionStatus, generateCopyTitle, copySessionMetadata, copySessionModeSettings } from '@/utils/sessionUtils';
import { useRouter } from 'expo-router';
import { t } from '@/text';
import { Modal } from '@/modal';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { leaveSharedSession } from '@/sync/apiSharing';
import {
    machineForkClaudeSession,
    machineForkCodexSession,
    machineForkGeminiSession,
    machineSpawnNewSession,
    sessionDelete,
    sessionKill,
} from '@/sync/ops';
import { cleanupWorkspace, cleanupWorktree } from '@/utils/worktreeOps';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { ActionMenuModal } from './ActionMenuModal';
import { ActionMenuItem } from './ActionMenu';
import { getSessionQuickActionKinds, SessionQuickActionKind } from './sessionQuickActions';
import { SessionContextMenuPortal } from './SessionContextMenuPortal';
import { SessionColorPalette } from './SessionColorMarker';
import type { SessionMarkerColor } from '@/sync/sessionAppearance';

type MenuPosition = { x: number; y: number };
type QuickAction = {
    kind: SessionQuickActionKind;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    destructive?: boolean;
    disabled?: boolean;
    onPress: () => void;
};

const MENU_WIDTH = 212;
const ITEM_HEIGHT = 42;
const MENU_PADDING = 8;
const PALETTE_HEIGHT = 46;

const styles = StyleSheet.create((theme) => ({
    menu: {
        position: 'absolute',
        width: MENU_WIDTH,
        paddingTop: MENU_PADDING,
        paddingBottom: 0,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
        elevation: 12,
        overflow: 'hidden',
    },
    item: {
        height: ITEM_HEIGHT,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    itemText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    destructiveText: {
        color: theme.colors.textDestructive,
    },
    disabled: {
        opacity: 0.45,
    },
}));

function useSessionQuickActions(session: Session) {
    const router = useRouter();
    const sessionStatus = useSessionStatus(session);
    const hasOrchestratorRuns = useOrchestratorHasRuns(session.id);
    const [forkingSession, setForkingSession] = React.useState(false);
    const [archiveMenuVisible, setArchiveMenuVisible] = React.useState(false);
    const [archiveMenuItems, setArchiveMenuItems] = React.useState<ActionMenuItem[]>([]);

    const [, performArchive] = useHappyAction(async () => {
        const previousActive = storage.getState().sessions[session.id]?.active ?? session.active;
        storage.getState().updateSessionActivity(session.id, false);
        const result = await sessionKill(session.id);
        const errorMessage = result.message || t('sessionInfo.failedToArchiveSession');
        if (!result.success && /RPC method not available/i.test(errorMessage)) {
            await sync.clearSessionMessageCache(session.id);
            return;
        }
        if (!result.success) {
            storage.getState().updateSessionActivity(session.id, previousActive);
            throw new HappyError(errorMessage, false);
        }
        await sync.clearSessionMessageCache(session.id);
    });

    const [, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
    });

    const [, performLeaveSharedSession] = useHappyAction(async () => {
        const credentials = sync.getCredentials();
        if (!credentials) throw new HappyError(t('common.error'), false);
        await leaveSharedSession(credentials, session.id);
        storage.getState().removeSharedSession(session.id);
    });

    const handleNewSession = React.useCallback(() => {
        const params = new URLSearchParams();
        if (session.metadata?.machineId) params.set('machineId', session.metadata.machineId);
        if (session.metadata?.path) params.set('path', session.metadata.path);
        const query = params.toString();
        router.push(query ? `/new?${query}` : '/new');
    }, [router, session.metadata?.machineId, session.metadata?.path]);

    const handleArchive = React.useCallback(() => {
        const workspaceRepos = getWorkspaceRepos(session.metadata);
        const machineId = session.metadata?.machineId;
        if (workspaceRepos.length > 0 && machineId) {
            const firstRepo = workspaceRepos[0];
            setArchiveMenuItems([
                { label: t('sessionInfo.worktree.archiveKeepWorktree'), onPress: performArchive },
                {
                    label: t('sessionInfo.worktree.archiveCleanupKeepBranch'),
                    onPress: async () => {
                        try {
                            if (workspaceRepos.length > 1 && session.metadata?.workspacePath) {
                                await cleanupWorkspace(machineId, session.metadata.workspacePath, workspaceRepos, false);
                            } else if (firstRepo?.basePath && firstRepo.branchName) {
                                await cleanupWorktree(machineId, firstRepo.basePath, firstRepo.branchName, false);
                            }
                        } catch (error) {
                            console.warn('Worktree cleanup failed:', error);
                        }
                        await performArchive();
                    },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupDeleteBranch'),
                    destructive: true,
                    onPress: async () => {
                        try {
                            if (workspaceRepos.length > 1 && session.metadata?.workspacePath) {
                                await cleanupWorkspace(machineId, session.metadata.workspacePath, workspaceRepos, true);
                            } else if (firstRepo?.basePath && firstRepo.branchName) {
                                await cleanupWorktree(machineId, firstRepo.basePath, firstRepo.branchName, true);
                            }
                        } catch (error) {
                            console.warn('Worktree cleanup failed:', error);
                        }
                        await performArchive();
                    },
                },
            ]);
            setArchiveMenuVisible(true);
            return;
        }
        Modal.alert(t('sessionInfo.archiveSession'), t('sessionInfo.archiveSessionConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.archiveSession'), style: 'destructive', onPress: performArchive },
        ]);
    }, [performArchive, session.metadata]);

    const handleDelete = React.useCallback(() => {
        Modal.alert(t('sessionInfo.deleteSession'), t('sessionInfo.deleteSessionWarning'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.deleteSession'), style: 'destructive', onPress: performDelete },
        ]);
    }, [performDelete]);

    const handleLeave = React.useCallback(() => {
        Modal.alert(t('sessionInfo.leaveSharedSession'), t('sessionInfo.leaveSharedSessionConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.leaveSharedSession'), style: 'destructive', onPress: performLeaveSharedSession },
        ]);
    }, [performLeaveSharedSession]);

    const handleFork = React.useCallback(async () => {
        if (forkingSession) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const machineId = session.metadata?.machineId;
        const directory = session.metadata?.path;
        if (!machineId || !directory || (!claudeSessionId && flavor !== 'gemini' && !codexSessionId)) return;

        const provider = flavor === 'gemini' ? 'Gemini' : flavor === 'codex' ? 'Codex' : 'Claude';
        const confirmed = await Modal.confirm(
            session.active ? t('sessionHistory.copyConfirmTitle') : t('sessionHistory.resumeConfirmTitle'),
            session.active
                ? t('sessionHistory.copyConfirmMessage', { provider })
                : t('sessionHistory.resumeConfirmMessage', { provider }),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;

        setForkingSession(true);
        try {
            const originalTitle = session.metadata?.summary?.text || getSessionName(session);
            const sessionTitle = session.active ? generateCopyTitle(originalTitle) : originalTitle;
            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'gemini' | 'codex' = 'claude';

            if (flavor === 'gemini') {
                const forkResult = await machineForkGeminiSession(machineId, session.id);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && codexSessionId) {
                const forkResult = await machineForkCodexSession(machineId, codexSessionId);
                if (!forkResult.success || !forkResult.newFilePath) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newFilePath;
                agent = 'codex';
            } else if (claudeSessionId) {
                const forkResult = await machineForkClaudeSession(machineId, claudeSessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
            }

            const result = await machineSpawnNewSession({
                machineId,
                directory,
                approvedNewDirectoryCreation: false,
                agent,
                resumeSessionId,
                sessionTitle,
                skipForkSession: true,
            });
            if (result.type === 'requestToApproveDirectoryCreation') {
                Modal.alert(t('common.error'), t('claudeHistory.directoryNotFound'));
                return;
            }
            if (result.type === 'error') {
                Modal.alert(t('common.error'), result.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            await sync.refreshSessions();
            await copySessionMetadata(session, result.sessionId).catch(error => console.warn('copySessionMetadata failed:', error));
            copySessionModeSettings(session, result.sessionId);
            router.push(`/session/${result.sessionId}`);
        } catch (error) {
            console.error('Failed to fork session', error);
            Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
        } finally {
            setForkingSession(false);
        }
    }, [forkingSession, router, session]);

    const handlers: Record<SessionQuickActionKind, () => void> = {
        details: () => router.push(`/session/${session.id}/info`),
        newSession: handleNewSession,
        delegationHistory: () => router.push(`/orchestrator?controllerSessionId=${encodeURIComponent(session.id)}`),
        manageSharing: () => router.push(`/session/${session.id}/sharing`),
        leaveSharedSession: handleLeave,
        viewMachine: () => router.push(`/machine/${session.metadata?.machineId}`),
        forkSession: handleFork,
        archiveSession: handleArchive,
        deleteSession: handleDelete,
    };
    const labels: Record<SessionQuickActionKind, string> = {
        details: t('sessionInfo.title'),
        newSession: t('sessionInfo.newSession'),
        delegationHistory: t('sessionInfo.delegationHistory'),
        manageSharing: t('session.sharing.manageSharing'),
        leaveSharedSession: t('sessionInfo.leaveSharedSession'),
        viewMachine: t('sessionInfo.viewMachine'),
        forkSession: session.active ? t('sessionInfo.copySession') : t('sessionInfo.resumeSession'),
        archiveSession: t('sessionInfo.archiveSession'),
        deleteSession: t('sessionInfo.deleteSession'),
    };
    const icons: Record<SessionQuickActionKind, QuickAction['icon']> = {
        details: 'information-circle-outline',
        newSession: 'add-circle-outline',
        delegationHistory: 'layers-outline',
        manageSharing: 'share-outline',
        leaveSharedSession: 'exit-outline',
        viewMachine: 'server-outline',
        forkSession: session.active ? 'copy-outline' : 'play-circle-outline',
        archiveSession: 'archive-outline',
        deleteSession: 'trash-outline',
    };
    const kinds = getSessionQuickActionKinds({ session, hasOrchestratorRuns, isConnected: sessionStatus.isConnected });
    const actions = kinds.map((kind): QuickAction => ({
        kind,
        label: labels[kind],
        icon: icons[kind],
        destructive: kind === 'leaveSharedSession' || kind === 'archiveSession' || kind === 'deleteSession',
        disabled: kind === 'forkSession' && forkingSession,
        onPress: handlers[kind],
    }));

    return {
        actions,
        archiveMenu: (
            <ActionMenuModal
                visible={archiveMenuVisible}
                title={t('sessionInfo.worktree.archiveWorktreeConfirm')}
                items={archiveMenuItems}
                onClose={() => setArchiveMenuVisible(false)}
            />
        ),
    };
}

export function SessionContextMenu({ session, children }: { session: Session; children: React.ReactNode }) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const safeArea = useSafeAreaInsets();
    const [position, setPosition] = React.useState<MenuPosition | null>(null);
    const [hoveredAction, setHoveredAction] = React.useState<SessionQuickActionKind | null>(null);
    const [nativeMenuVisible, setNativeMenuVisible] = React.useState(false);
    const menuRef = React.useRef<HTMLElement | null>(null);
    const lastLongPressAtRef = React.useRef(0);
    const { actions, archiveMenu } = useSessionQuickActions(session);
    const markerColor = useSessionMarkerColor(session.id);
    const nativeQuickActionsMaxHeight = Math.max(
        240,
        height - safeArea.top - safeArea.bottom - 72,
    );

    const closeMenu = React.useCallback(() => {
        setPosition(null);
        setHoveredAction(null);
    }, []);

    const selectMarkerColor = React.useCallback((color: SessionMarkerColor | null) => {
        closeMenu();
        setNativeMenuVisible(false);
        sync.queueSessionMarkerColorUpdate(session.id, color);
    }, [closeMenu, session.id]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || position === null || typeof document === 'undefined') return;

        const isInsideMenu = (target: EventTarget | null) => (
            target instanceof Node && menuRef.current?.contains(target)
        );
        const handlePointerDown = (event: PointerEvent) => {
            if (!isInsideMenu(event.target)) closeMenu();
        };
        const handleContextMenuOutside = (event: MouseEvent) => {
            if (isInsideMenu(event.target)) {
                event.preventDefault();
                return;
            }
            // Do not prevent the event here. A session row may replace this menu,
            // while every other target should keep the browser/system menu.
            closeMenu();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeMenu();
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('contextmenu', handleContextMenuOutside, true);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('scroll', closeMenu, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('contextmenu', handleContextMenuOutside, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('scroll', closeMenu, true);
        };
    }, [closeMenu, position]);

    if (Platform.OS !== 'web') {
        const child = React.isValidElement(children)
            ? React.cloneElement(children as React.ReactElement<any>, {
                onLongPress: (event: unknown) => {
                    (children.props as { onLongPress?: (event: unknown) => void }).onLongPress?.(event);
                    lastLongPressAtRef.current = Date.now();
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setNativeMenuVisible(true);
                },
                onPress: (event: unknown) => {
                    if (Date.now() - lastLongPressAtRef.current < 1_000) return;
                    (children.props as { onPress?: (event: unknown) => void }).onPress?.(event);
                },
                delayLongPress: 450,
            })
            : children;
        const nativeItems: ActionMenuItem[] = actions.map(action => ({
            label: action.label,
            destructive: action.destructive,
            disabled: action.disabled,
            onPress: action.onPress,
        }));

        return (
            <>
                {child}
                <ActionMenuModal
                    visible={nativeMenuVisible}
                    title={t('sessionInfo.quickActions')}
                    items={nativeItems}
                    onClose={() => setNativeMenuVisible(false)}
                    maxHeight={nativeQuickActionsMaxHeight}
                    footerContent={(
                        <SessionColorPalette
                            selectedColor={markerColor}
                            onSelect={selectMarkerColor}
                        />
                    )}
                />
                {archiveMenu}
            </>
        );
    }

    const menuHeight = actions.length * ITEM_HEIGHT + MENU_PADDING + PALETTE_HEIGHT;
    const left = position ? Math.max(8, Math.min(position.x, width - MENU_WIDTH - 8)) : 0;
    const top = position ? Math.max(8, Math.min(position.y, height - menuHeight - 8)) : 0;
    const handleContextMenu = (event: {
        preventDefault: () => void;
        stopPropagation: () => void;
        nativeEvent: { pageX: number; pageY: number; clientX?: number; clientY?: number };
    }) => {
        event.preventDefault();
        event.stopPropagation();
        setHoveredAction(null);
        setPosition({
            x: event.nativeEvent.clientX ?? event.nativeEvent.pageX,
            y: event.nativeEvent.clientY ?? event.nativeEvent.pageY,
        });
    };
    const webContextMenuProps = { onContextMenu: handleContextMenu };

    return (
        <>
            <View {...webContextMenuProps}>{children}</View>
            {position !== null && (
                <SessionContextMenuPortal>
                    <View
                        ref={(node) => { menuRef.current = node as unknown as HTMLElement | null; }}
                        pointerEvents="auto"
                        style={[styles.menu, { left, top }]}
                    >
                        {actions.map(action => (
                            <Pressable
                                key={action.kind}
                                disabled={action.disabled}
                                onHoverIn={() => setHoveredAction(action.kind)}
                                onHoverOut={() => setHoveredAction(current => current === action.kind ? null : current)}
                                onPress={(event) => {
                                    event.stopPropagation?.();
                                    closeMenu();
                                    action.onPress();
                                }}
                                style={({ pressed }) => [
                                    styles.item,
                                    (pressed || hoveredAction === action.kind) && { backgroundColor: theme.colors.surfacePressed },
                                    action.disabled && styles.disabled,
                                ]}
                            >
                                <Ionicons
                                    name={action.icon}
                                    size={18}
                                    color={action.destructive ? theme.colors.textDestructive : theme.colors.textSecondary}
                                />
                                <Text style={[styles.itemText, action.destructive && styles.destructiveText]} numberOfLines={1}>
                                    {action.label}
                                </Text>
                            </Pressable>
                        ))}
                        <SessionColorPalette
                            selectedColor={markerColor}
                            onSelect={selectMarkerColor}
                            compact
                        />
                    </View>
                </SessionContextMenuPortal>
            )}
            {archiveMenu}
        </>
    );
}
