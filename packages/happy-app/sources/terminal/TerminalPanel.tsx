import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { storage, useLocalSettingMutable } from '@/sync/storage';
import { t } from '@/text';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { useTerminalWorkspace } from '@/hooks/useTerminalWorkspace';
import { resolveTerminalDirectory } from './openTerminal';
import { canOpenTerminalWindow, openTerminalWindow } from './openMachineTerminal';
import { TerminalNewSheets } from './TerminalNewSheets';
import { TerminalPanelIcon, type TerminalPanelIconName } from './TerminalPanelIcon';
import { setTooltip, TerminalPanelList } from './TerminalPanelList';
import { TerminalScreen } from './TerminalScreen';
import { terminalTabKey, type TerminalTab } from './terminalTabs';
import {
    clampTerminalPanelHeight,
    clampTerminalPanelListWidth,
    markTerminalPanelEngaged,
    resolveTerminalPanelColors,
    resolveTerminalPanelContext,
    setTerminalPanelOpen,
    TERMINAL_PANEL_DEFAULT_HEIGHT,
    TERMINAL_PANEL_LIST_COMPACT_WIDTH,
    TERMINAL_PANEL_LIST_MIN_WIDTH,
    TERMINAL_PANEL_LIST_DEFAULT_WIDTH,
    useTerminalPanelEngaged,
    useTerminalPanelFocus,
} from './terminalPanel';

/**
 * The terminal panel along the bottom of the app (see `terminalPanel.ts`): the shell on screen,
 * and beside it, once there are two or more, every terminal grouped by machine.
 *
 * Mounted the first time it is opened and kept from then on: closing it only hides it, so its
 * screens and scrollback are where they were when it is opened again. The shells themselves
 * live on the daemons either way.
 *
 * `columnHeight` is the height of the column the panel shares with the page above it, which is
 * what a drag or a maximise is bounded by.
 */
export const TerminalPanel = memo(({ open, columnHeight }: { open: boolean; columnHeight: number }) => {
    const { theme } = useUnistyles();
    // The header and the list wear the terminal's colours, so the panel reads as one shell.
    const terminalTheme = useTerminalTheme();
    const colors = useMemo(() => resolveTerminalPanelColors(terminalTheme), [terminalTheme]);
    const pathname = usePathname();
    const focus = useTerminalPanelFocus();
    // A panel restored open with the app leaves the keyboard with the page until it is used.
    const engaged = useTerminalPanelEngaged();
    const {
        tabs,
        orderedTabs,
        mountedTabs,
        loaded,
        isBusy,
        activeTab,
        activeKey,
        labels,
        status,
        machineNameById,
        spawnIn,
        handleNew,
        handleClose,
        handleRename,
        handleSelect,
        handleDuplicate,
        sheets,
    } = useTerminalWorkspace(focus);

    // ------------------------------------------------------------------
    // Size: the panel's height, dragged at its top edge, and the list's
    // width, dragged at its left one. Both are remembered once let go.
    // ------------------------------------------------------------------

    const [storedHeight, setStoredHeight] = useLocalSettingMutable('terminalPanelHeight');
    const [storedListWidth, setStoredListWidth] = useLocalSettingMutable('terminalPanelListWidth');
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const [dragListWidth, setDragListWidth] = useState<number | null>(null);
    const [maximized, setMaximized] = useState(false);
    const [bodyWidth, setBodyWidth] = useState(0);

    const wanted = dragHeight ?? (maximized ? Number.MAX_SAFE_INTEGER : storedHeight ?? TERMINAL_PANEL_DEFAULT_HEIGHT);
    // Before the column has been measured there is nothing to bound by yet.
    const height = columnHeight > 0
        ? clampTerminalPanelHeight(wanted, columnHeight)
        : Math.min(wanted, TERMINAL_PANEL_DEFAULT_HEIGHT);
    const listWidth = clampTerminalPanelListWidth(
        dragListWidth ?? storedListWidth ?? TERMINAL_PANEL_LIST_DEFAULT_WIDTH,
        bodyWidth > 0 ? bodyWidth : TERMINAL_PANEL_LIST_DEFAULT_WIDTH * 2,
    );

    // Read by the drags, which outlive the render that started them.
    const latest = useRef({ height, listWidth, columnHeight, bodyWidth, setStoredHeight, setStoredListWidth });
    latest.current = { height, listWidth, columnHeight, bodyWidth, setStoredHeight, setStoredListWidth };
    const dragStart = useRef(0);

    const heightResponder = useMemo(() => {
        const next = (dy: number) => {
            const { columnHeight: available } = latest.current;
            const wantedHeight = dragStart.current - dy;
            return available > 0 ? clampTerminalPanelHeight(wantedHeight, available) : Math.round(wantedHeight);
        };
        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderTerminationRequest: () => false,
            onPanResponderGrant: () => {
                holdTextSelection('row-resize');
                dragStart.current = latest.current.height;
                setMaximized(false);
                setDragHeight(latest.current.height);
            },
            onPanResponderMove: (_event, gesture) => setDragHeight(next(gesture.dy)),
            onPanResponderRelease: (_event, gesture) => {
                releaseTextSelection();
                latest.current.setStoredHeight(next(gesture.dy));
                setDragHeight(null);
            },
            onPanResponderTerminate: () => {
                releaseTextSelection();
                setDragHeight(null);
            },
        });
    }, []);

    const listResponder = useMemo(() => {
        const next = (dx: number) => clampTerminalPanelListWidth(dragStart.current - dx, latest.current.bodyWidth);
        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderTerminationRequest: () => false,
            onPanResponderGrant: () => {
                holdTextSelection('col-resize');
                dragStart.current = latest.current.listWidth;
                setDragListWidth(latest.current.listWidth);
            },
            onPanResponderMove: (_event, gesture) => setDragListWidth(next(gesture.dx)),
            onPanResponderRelease: (_event, gesture) => {
                releaseTextSelection();
                // Let go in between, it settles on the narrowest list rather than a half-squeezed one.
                const width = next(gesture.dx);
                latest.current.setStoredListWidth(
                    width < TERMINAL_PANEL_LIST_COMPACT_WIDTH ? TERMINAL_PANEL_LIST_MIN_WIDTH : width,
                );
                setDragListWidth(null);
            },
            onPanResponderTerminate: () => {
                releaseTextSelection();
                setDragListWidth(null);
            },
        });
    }, []);

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    // A new shell goes where the page on screen is about: a session's directory, a machine's
    // home. Anywhere else there is nothing to go by, so it asks.
    const handleNewHere = useCallback(() => {
        if (isBusy) {
            return;
        }
        const context = resolveTerminalPanelContext(pathname);
        const state = storage.getState();
        if (context?.kind === 'session') {
            const session = state.sessions[context.sessionId];
            const machineId = session?.metadata?.machineId;
            const path = session?.metadata?.path;
            if (machineId && path) {
                void spawnIn(machineId, path);
                return;
            }
        }
        if (context?.kind === 'machine') {
            const machine = state.machines[context.machineId];
            if (machine) {
                void spawnIn(machine.id, resolveTerminalDirectory({ homeDir: machine.metadata?.homeDir }));
                return;
            }
        }
        handleNew();
    }, [handleNew, isBusy, pathname, spawnIn]);

    const handleOpenInWindow = useCallback(() => {
        if (!activeTab) {
            return;
        }
        // Moved rather than copied: the panel steps aside, so the shell is not drawn twice at
        // two sizes it would keep being resized between.
        if (openTerminalWindow({ machineId: activeTab.machineId, terminalId: activeTab.terminal.id })) {
            setTerminalPanelOpen(false);
        }
    }, [activeTab]);

    // Closing the last shell leaves the panel nothing to show, so it goes with it. A shell that
    // exits by itself (`exit`, Ctrl+D) is closed the same way, as an editor's panel does, rather
    // than left behind as a dead screen.
    const handleCloseTerminal = useCallback(
        (tab: TerminalTab) => {
            if (tabs.length <= 1) {
                setMaximized(false);
                setTerminalPanelOpen(false);
            }
            handleClose(tab);
        },
        [handleClose, tabs.length],
    );

    const handleClosePanel = useCallback(() => {
        setMaximized(false);
        setTerminalPanelOpen(false);
    }, []);

    const showList = tabs.length >= 2;
    const compactList = listWidth < TERMINAL_PANEL_LIST_COMPACT_WIDTH;
    // `selected` keeps the hover look on a button whose state is on, such as maximise.
    const headerButton = (name: TerminalPanelIconName, label: string, onPress: () => void, disabled = false, selected = false) => (
        <Pressable
            ref={setTooltip(label)}
            accessibilityLabel={label}
            accessibilityRole="button"
            disabled={disabled}
            hitSlop={4}
            onPress={onPress}
            style={({ hovered }: any) => [
                styles.headerButton,
                (selected || (hovered && !disabled)) && { backgroundColor: colors.hover },
                disabled && styles.disabled,
            ]}
        >
            <View style={styles.headerIcon}>
                <TerminalPanelIcon color={colors.foreground} name={name} />
            </View>
        </Pressable>
    );

    return (
        <View
            // Any press inside is someone using the panel, after which it may take the keyboard.
            {...({ onPointerDown: markTerminalPanelEngaged } as object)}
            style={[
                styles.root,
                {
                    backgroundColor: colors.background,
                    borderTopColor: theme.colors.divider,
                    display: open ? 'flex' : 'none',
                    height,
                },
            ]}
        >
            {/* Straddles the panel's top edge, so the line can be caught from either side of it. */}
            <View {...heightResponder.panHandlers} style={[styles.heightHandle, { cursor: 'row-resize' } as object]} />
            <View style={styles.header}>
                <Text numberOfLines={1} selectable={false} style={[styles.title, { color: colors.foreground }]}>
                    {status ?? t('terminalSession.title')}
                </Text>
                {headerButton('add', t('terminalSession.newTerminal'), handleNewHere, isBusy)}
                {/* With the list hidden, or too narrow for its own, there is nowhere else to close
                    the shell on screen from. */}
                {(!showList || compactList) && activeTab
                    ? headerButton('trash', t('terminalSession.closeTerminal'), () => handleCloseTerminal(activeTab))
                    : null}
                {canOpenTerminalWindow()
                    ? headerButton('window', t('terminalSession.openInWindow'), handleOpenInWindow, !activeTab)
                    : null}
                {headerButton(
                    'maximize',
                    maximized ? t('terminalSession.restorePanel') : t('terminalSession.maximizePanel'),
                    () => setMaximized((value) => !value),
                    false,
                    maximized,
                )}
                {headerButton('close', t('terminalSession.closePanel'), handleClosePanel)}
            </View>
            <View style={styles.body} onLayout={(event) => setBodyWidth(event.nativeEvent.layout.width)}>
                <View style={styles.screens}>
                    {activeTab && activeKey ? (
                        // Keyed by tab, so a tab keeps its screen as long as it stays mounted; the
                        // ones not on screen are hidden rather than torn down, which is what keeps
                        // their scrollback.
                        mountedTabs.map((tab) => {
                            const key = terminalTabKey(tab);
                            const isActive = key === activeKey;
                            return (
                                <View key={key} style={isActive ? styles.screen : styles.hiddenScreen}>
                                    <TerminalScreen
                                        active={isActive && open}
                                        autoFocus={engaged}
                                        keyBar={false}
                                        machineId={tab.machineId}
                                        onExit={() => handleCloseTerminal(tab)}
                                        terminalId={tab.terminal.id}
                                    />
                                </View>
                            );
                        })
                    ) : !loaded ? (
                        <View style={styles.centered}>
                            <ActivityIndicator color={colors.foreground} />
                        </View>
                    ) : (
                        <View style={styles.centered}>
                            <Text style={[styles.emptyText, { color: colors.foreground }]}>
                                {t('terminalSession.empty')}
                            </Text>
                            <Pressable disabled={isBusy} onPress={handleNewHere} style={styles.emptyButton}>
                                <Text style={{ color: theme.colors.textLink }}>{t('terminalSession.newTerminal')}</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
                {showList ? (
                    <View style={[styles.list, { borderLeftColor: colors.divider, width: listWidth }]}>
                        <View {...listResponder.panHandlers} style={[styles.listHandle, { cursor: 'col-resize' } as object]} />
                        <TerminalPanelList
                            activeKey={activeKey}
                            colors={colors}
                            compact={compactList}
                            labels={labels}
                            machineNameById={machineNameById}
                            onClose={handleCloseTerminal}
                            onDuplicate={handleDuplicate}
                            onRename={handleRename}
                            onSelect={handleSelect}
                            tabs={orderedTabs}
                        />
                    </View>
                ) : null}
            </View>
            <TerminalNewSheets state={sheets} />
        </View>
    );
});

// While a drag is on, the page under the pointer must not start selecting text, which it does on
// the web as soon as the pointer leaves the handle; the resize cursor stays on the whole way too.
function holdTextSelection(cursor: string) {
    if (Platform.OS !== 'web') {
        return;
    }
    const style = document.body.style;
    style.userSelect = 'none';
    style.setProperty('-webkit-user-select', 'none');
    style.cursor = cursor;
    window.getSelection()?.removeAllRanges();
}

function releaseTextSelection() {
    if (Platform.OS !== 'web') {
        return;
    }
    const style = document.body.style;
    style.userSelect = '';
    style.removeProperty('-webkit-user-select');
    style.cursor = '';
}

const HANDLE_SIZE = 10;

const styles = StyleSheet.create({
    root: {
        borderTopWidth: StyleSheet.hairlineWidth,
        position: 'relative',
    },
    heightHandle: {
        height: HANDLE_SIZE,
        left: 0,
        position: 'absolute',
        right: 0,
        top: -HANDLE_SIZE / 2,
        zIndex: 10,
    },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 2,
        height: 32,
        paddingLeft: 12,
        paddingRight: 6,
    },
    title: {
        flex: 1,
        fontFamily: 'Menlo',
        fontSize: 12,
        opacity: 0.75,
    },
    headerButton: {
        alignItems: 'center',
        borderRadius: 4,
        justifyContent: 'center',
        height: 24,
        width: 24,
    },
    headerIcon: {
        opacity: 0.85,
    },
    disabled: {
        opacity: 0.4,
    },
    body: {
        flex: 1,
        flexDirection: 'row',
    },
    screens: {
        flex: 1,
    },
    screen: {
        flex: 1,
    },
    hiddenScreen: {
        display: 'none',
        flex: 1,
    },
    list: {
        borderLeftWidth: StyleSheet.hairlineWidth,
        position: 'relative',
    },
    listHandle: {
        bottom: 0,
        left: -HANDLE_SIZE / 2,
        position: 'absolute',
        top: 0,
        width: HANDLE_SIZE,
        zIndex: 10,
    },
    centered: {
        alignItems: 'center',
        flex: 1,
        gap: 8,
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    emptyText: {
        fontSize: 13,
        opacity: 0.6,
        textAlign: 'center',
    },
    emptyButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
});
