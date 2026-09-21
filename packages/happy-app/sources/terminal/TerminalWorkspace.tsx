import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useUnistyles } from 'react-native-unistyles';
import type { TerminalOkResponse, TerminalRefRequest } from 'happy-wire';
import { apiSocket } from '@/sync/apiSocket';
import { isTerminalWindow } from '@/desktop/desktopWindowUtils';
import { useTerminalWindowCloseRequest } from '@/desktop/useTerminalWindowCloseRequest';
import { useAllMachines, useLocalSettingMutable, useMachine } from '@/sync/storage';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { t } from '@/text';
import { showToast } from '@/components/Toast';
import { Modal } from '@/modal';
import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { NewTerminalSheet } from './NewTerminalSheet';
import { listMachineTerminals, spawnTerminal } from './openTerminal';
import { TerminalScreen } from './TerminalScreen';
import { TerminalTabBar } from './TerminalTabBar';
import { TerminalWindowTitleRow } from './TerminalWindowTitleRow';
import {
    applyTerminalTabOrder,
    resolveActiveTerminalTab,
    resolveTerminalTabLabels,
    shortenTerminalDirectory,
    sortTerminalTabs,
    terminalTabKey,
    type TerminalTab,
} from './terminalTabs';

export interface TerminalWorkspaceProps {
    /**
     * The tab something asked for.
     *
     * A new object arrives for every request, including a repeat of the tab
     * already on screen — asking again has to bring it back into view, and an
     * unchanged value cannot do that.
     */
    focus?: { machineId: string; terminalId: string } | null;
}

/**
 * The terminal surface: every shell on every machine, one tab each.
 *
 * The tab set comes from each machine's daemon rather than from anything
 * remembered here, so it is the same set in every window and on every device,
 * and a terminal that outlives the app simply reappears. One `TerminalScreen`
 * is mounted at a time — the inactive tabs are live on their daemons, not in
 * this view, so there is nothing to keep mounted for them.
 */
export const TerminalWorkspace = memo(({ focus = null }: TerminalWorkspaceProps) => {
    const { theme } = useUnistyles();
    const machines = useAllMachines();
    const machineNameById = useMachineNameMap();

    const [tabs, setTabs] = useState<TerminalTab[]>([]);
    const [requested, setRequested] = useState(focus);
    const [loaded, setLoaded] = useState(false);
    const [isBusy, setIsBusy] = useState(false);

    // The machine and directory last chosen, so the next terminal starts from
    // the same place instead of asking twice for an answer already given.
    const [newTarget, setNewTarget] = useLocalSettingMutable('terminalNewTarget');
    // The order the tabs were dragged into. Device-local on purpose: a phone and
    // a desktop have different screens and rarely want the same strip.
    const [tabOrder, setTabOrder] = useLocalSettingMutable('terminalTabOrder');
    // Names given to tabs by hand. Device-local for the same reason the order
    // is: it is this strip's own reading of its shells, and the daemon knows
    // nothing about it.
    const [tabNames, setTabNames] = useLocalSettingMutable('terminalTabNames');

    // Only the ids matter, and the machine list is a fresh array on every store
    // write — depending on the array itself would re-list on every sync tick.
    const machineIdsKey = machines.map((machine) => machine.id).join(',');

    const refresh = useCallback(async () => {
        const ids = machineIdsKey.length > 0 ? machineIdsKey.split(',') : [];
        if (ids.length === 0) {
            setTabs([]);
            setLoaded(true);
            return;
        }
        // Each machine answers on its own, so one that is slow — or running a
        // CLI too old to have terminals in it — costs only its own tabs.
        await Promise.all(
            ids.map(async (machineId) => {
                try {
                    const listed = await listMachineTerminals(machineId);
                    setTabs((current) =>
                        sortTerminalTabs([
                            ...current.filter((tab) => tab.machineId !== machineId),
                            ...listed,
                        ]),
                    );
                } catch (listError) {
                    console.warn(`Could not list terminals on ${machineId}:`, listError);
                }
            }),
        );
        setLoaded(true);
    }, [machineIdsKey]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Held in a ref so the focus effect below can depend on the request alone.
    // `refresh` changes whenever the machine list does, and re-running this on
    // that would yank the view back to the requested tab every time a machine
    // came or went.
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;

    useEffect(() => {
        if (!focus) {
            return;
        }
        setRequested(focus);
        // The tab may not exist here yet: a window that was already open is
        // being sent to a shell that was just started for it, from a session
        // menu that had no way to tell this window about it.
        void refreshRef.current();
    }, [focus]);

    const activeTab = useMemo(() => resolveActiveTerminalTab(tabs, requested), [requested, tabs]);
    const activeKey = activeTab ? terminalTabKey(activeTab) : null;
    const labels = useMemo(
        () => resolveTerminalTabLabels(tabs, (machineId) => machineNameById.get(machineId), tabNames),
        [machineNameById, tabNames, tabs],
    );
    // Only the strip is reordered. Which tab is active is decided from creation
    // order, whose "newest is last" fallback the dragged order would break.
    const orderedTabs = useMemo(() => applyTerminalTabOrder(tabs, tabOrder), [tabs, tabOrder]);

    const activeHomeDir = useMachine(activeTab?.machineId ?? '')?.metadata?.homeDir;
    const status = useMemo(() => {
        if (!activeTab) {
            return undefined;
        }
        const directory = shortenTerminalDirectory(activeTab.terminal.cwd, activeHomeDir);
        const name = machineNameById.get(activeTab.machineId);
        if (!directory) {
            // A daemon that never recorded a directory leaves nothing to say
            // about where the shell is, and the machine alone reads better than
            // a separator with nothing after it.
            return name;
        }
        return name ? `${name} · ${directory}` : directory;
    }, [activeHomeDir, activeTab, machineNameById]);

    // ------------------------------------------------------------------
    // Starting a terminal
    //
    // Both questions get asked every time — which machine, then which
    // directory — because a new shell silently landing somewhere unexpected is
    // worse than one more tap. The remembered answer is what each step opens
    // on, so repeating the last one costs a tap on the machine and a tap on
    // Select rather than a search.
    // ------------------------------------------------------------------

    const machineSheetRef = useRef<BottomSheetModal>(null);
    const folderSheetRef = useRef<BottomSheetModal>(null);
    // Set only when a machine was actually chosen. The sheet also goes away on a
    // backdrop tap or a swipe, which mean the person changed their mind and must
    // not pull the directory question up behind it.
    const pickedMachineRef = useRef<string | null>(null);
    // A fresh object on every pick, so choosing the same machine twice still
    // reopens the sheet — an unchanged value cannot make that happen.
    const [folderRequest, setFolderRequest] = useState<{ machineId: string; initialPath?: string } | null>(null);

    // Presented from an effect because the sheet only mounts on the render this
    // state change causes: calling `present()` in the same tick would reach for
    // a ref that is not attached yet.
    useEffect(() => {
        if (folderRequest) {
            folderSheetRef.current?.present();
        }
    }, [folderRequest]);

    const handleNew = useCallback(() => {
        if (isBusy || machines.length === 0) {
            return;
        }
        pickedMachineRef.current = null;
        machineSheetRef.current?.present();
    }, [isBusy, machines.length]);

    const handleMachinePicked = useCallback((machineId: string) => {
        pickedMachineRef.current = machineId;
        // The directory is asked for in this sheet's dismissal rather than here:
        // presenting it while this one is still animating out would leave two
        // sheets on screen at once, over one backdrop.
        machineSheetRef.current?.dismiss();
    }, []);

    const handleMachineSheetDismissed = useCallback(() => {
        const machineId = pickedMachineRef.current;
        pickedMachineRef.current = null;
        if (!machineId) {
            return;
        }
        // The remembered directory is only carried across when it belongs to the
        // machine just picked; on any other machine it is a different disk.
        setFolderRequest({
            machineId,
            initialPath: newTarget?.machineId === machineId ? newTarget.cwd : undefined,
        });
    }, [newTarget]);

    const handleDirectoryPicked = useCallback(
        (cwd: string) => {
            const machineId = folderRequest?.machineId;
            if (!machineId) {
                return;
            }
            setIsBusy(true);
            void spawnTerminal({ machineId, cwd })
                .then(async (created) => {
                    // Remembered only once it worked: a machine that turned out to
                    // be away is not somewhere the next terminal should open on.
                    setNewTarget({ machineId, cwd });
                    await refresh();
                    setRequested({ machineId, terminalId: created.id });
                })
                .catch((spawnError) => {
                    console.warn(`Could not start a terminal on ${machineId}:`, spawnError);
                    showToast(t('terminalSession.openFailed'));
                })
                .finally(() => setIsBusy(false));
        },
        [folderRequest, refresh, setNewTarget],
    );

    const handleClose = useCallback(
        (tab: TerminalTab) => {
            // Dropped from the strip before the round trip, not after it: the
            // same gesture that closes one tab closes the next one, and a list
            // that still holds the first would close it twice over. A dispose
            // that fails brings the tab back with the refresh below.
            const key = terminalTabKey(tab);
            setTabs((current) => current.filter((other) => terminalTabKey(other) !== key));
            // The name goes with it. Nothing else would: the tab is gone from
            // every device, and the key it was filed under never comes back.
            if (key in tabNames) {
                const remaining = { ...tabNames };
                delete remaining[key];
                setTabNames(remaining);
            }
            // Disposing rather than merely closing: a tab that stayed after
            // being closed would have no way to be dismissed, and the daemon
            // would hold the record for the life of the process.
            void apiSocket
                .machineRPC<TerminalOkResponse, TerminalRefRequest>(tab.machineId, 'terminal-dispose', {
                    terminalId: tab.terminal.id,
                })
                .then(refresh)
                .catch(() => {
                    // It may already be gone; the refresh below is the point.
                    void refresh();
                });
        },
        [refresh, setTabNames, tabNames],
    );

    const handleRename = useCallback(
        async (tab: TerminalTab) => {
            const key = terminalTabKey(tab);
            const chosen = await Modal.prompt(
                t('common.rename'),
                t('terminalSession.renameTerminalHint'),
                {
                    // What it reads now is the placeholder rather than the value:
                    // the field starts empty for a tab that has no name of its
                    // own, so opening the prompt and confirming cannot quietly
                    // turn the current label into one.
                    defaultValue: tabNames[key] ?? '',
                    placeholder: labels.get(key) ?? '',
                    cancelText: t('common.cancel'),
                    confirmText: t('common.rename'),
                },
            );
            if (chosen === null) {
                return;
            }
            const name = chosen.trim();
            const next = { ...tabNames };
            if (name) {
                next[key] = name;
            } else {
                // Cleared rather than stored empty, so the tab goes back to
                // reading what it is instead of to a blank.
                delete next[key];
            }
            setTabNames(next);
        },
        [labels, setTabNames, tabNames],
    );

    const handleSelect = useCallback((tab: TerminalTab) => {
        setRequested({ machineId: tab.machineId, terminalId: tab.terminal.id });
    }, []);

    const handleReorder = useCallback(
        (order: readonly string[]) => {
            setTabOrder([...order]);
        },
        [setTabOrder],
    );

    const handleDuplicate = useCallback(
        (tab: TerminalTab) => {
            // The same machine and the same directory, a second shell: what is
            // wanted is another prompt in a place already set up, so this asks
            // for a new terminal rather than for the one already there.
            void spawnTerminal({ machineId: tab.machineId, cwd: tab.terminal.cwd })
                .then(async (created) => {
                    await refresh();
                    setRequested({ machineId: tab.machineId, terminalId: created.id });
                })
                .catch((duplicateError) => {
                    console.warn(`Could not duplicate a terminal on ${tab.machineId}:`, duplicateError);
                    showToast(t('terminalSession.duplicateFailed'));
                });
        },
        [refresh],
    );

    // In the terminal window, closing the window closes one tab and the window
    // only goes once there is nothing left to close. Anywhere else this window
    // is the app's, not a terminal's, and none of it applies.
    useTerminalWindowCloseRequest({
        tabCount: tabs.length,
        closeTab: activeTab ? () => handleClose(activeTab) : null,
    });

    if (!loaded && tabs.length === 0) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator color={theme.colors.text} />
            </View>
        );
    }

    const tabBar = (
        <TerminalTabBar
            activeKey={activeKey}
            isBusy={isBusy}
            labels={labels}
            onClose={handleClose}
            onDuplicate={handleDuplicate}
            onNew={handleNew}
            onRename={handleRename}
            onReorder={handleReorder}
            onSelect={handleSelect}
            tabs={orderedTabs}
        />
    );

    return (
        <View style={styles.root}>
            {isTerminalWindow() ? (
                <TerminalWindowTitleRow>{tabBar}</TerminalWindowTitleRow>
            ) : (
                <View
                    style={[
                        styles.tabBarRow,
                        { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.divider },
                    ]}
                >
                    {tabBar}
                </View>
            )}
            {activeTab && activeKey ? (
                // Keyed so switching tabs tears down the previous stream instead
                // of leaving it subscribed to a terminal nobody is looking at.
                <TerminalScreen
                    key={activeKey}
                    machineId={activeTab.machineId}
                    status={status}
                    terminalId={activeTab.terminal.id}
                />
            ) : (
                <View style={styles.centered}>
                    <Text style={[styles.emptyText, { color: theme.colors.text }]}>
                        {t('terminalSession.empty')}
                    </Text>
                    <Pressable onPress={handleNew} style={styles.emptyButton}>
                        <Text style={{ color: theme.colors.textLink }}>{t('terminalSession.newTerminal')}</Text>
                    </Pressable>
                </View>
            )}
            <NewTerminalSheet
                ref={machineSheetRef}
                lastUsedMachineId={newTarget?.machineId}
                machines={machines}
                names={machineNameById}
                onDismiss={handleMachineSheetDismissed}
                onSelect={handleMachinePicked}
            />
            {folderRequest ? (
                <FolderPickerSheet
                    ref={folderSheetRef}
                    homeDir={machines.find((machine) => machine.id === folderRequest.machineId)?.metadata?.homeDir}
                    initialPath={folderRequest.initialPath}
                    machineId={folderRequest.machineId}
                    onSelect={handleDirectoryPicked}
                />
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    tabBarRow: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    centered: {
        alignItems: 'center',
        flex: 1,
        gap: 12,
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    emptyText: {
        fontSize: 14,
        opacity: 0.6,
        textAlign: 'center',
    },
    emptyButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
});
