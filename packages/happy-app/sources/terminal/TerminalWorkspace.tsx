import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { isTerminalWindow } from '@/desktop/desktopWindowUtils';
import { useTerminalWindowCloseRequest } from '@/desktop/useTerminalWindowCloseRequest';
import { useTerminalPopupCloseConfirm } from './useTerminalPopupCloseConfirm';
import { t } from '@/text';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';
import { useTerminalWorkspace } from '@/hooks/useTerminalWorkspace';
import { TerminalNewSheets } from './TerminalNewSheets';
import { TerminalScreen } from './TerminalScreen';
import { TerminalTabBar } from './TerminalTabBar';
import { TerminalWindowTitleRow } from './TerminalWindowTitleRow';
import { terminalTabKey } from './terminalTabs';

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
 * The terminal screen: every shell on every machine, one tab each, in a strip along the top.
 *
 * The screen of its own on phones and tablets, and the content of the desktop terminal window
 * and the browser's terminal popup. What it holds and does is `useTerminalWorkspace`'s.
 */
export const TerminalWorkspace = memo(({ focus = null }: TerminalWorkspaceProps) => {
    const { theme } = useUnistyles();
    const softHeaderInset = useSoftHeaderInset();
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
        handleNew,
        handleClose,
        handleRename,
        handleSelect,
        handleReorder,
        handleDuplicate,
        sheets,
    } = useTerminalWorkspace(focus);

    // In the terminal window, closing the window closes one tab and the window
    // only goes once there is nothing left to close. Anywhere else this window
    // is the app's, not a terminal's, and none of it applies.
    useTerminalWindowCloseRequest({
        tabCount: tabs.length,
        closeTab: activeTab ? () => handleClose(activeTab) : null,
    });
    useTerminalPopupCloseConfirm(tabs.length);

    if (!loaded && tabs.length === 0) {
        return (
            <View style={[styles.centered, { paddingTop: softHeaderInset }]}>
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
                // Padded down past the soft header rather than placed under it: the strip's own
                // surface then runs up behind the header, which reads as one bar instead of a
                // header floating over a gap.
                <View
                    style={[
                        styles.tabBarRow,
                        {
                            backgroundColor: theme.colors.surface,
                            borderBottomColor: theme.colors.divider,
                            paddingTop: softHeaderInset,
                        },
                    ]}
                >
                    {tabBar}
                </View>
            )}
            {activeTab && activeKey ? (
                // Keyed by tab, so a tab keeps its screen as long as it stays mounted; the ones not
                // on screen are hidden rather than torn down, which is what keeps their scrollback.
                <View style={styles.screens}>
                    {mountedTabs.map((tab) => {
                        const key = terminalTabKey(tab);
                        const isActive = key === activeKey;
                        return (
                            <View key={key} style={isActive ? styles.screen : styles.hiddenScreen}>
                                <TerminalScreen
                                    active={isActive}
                                    machineId={tab.machineId}
                                    status={isActive ? status : undefined}
                                    terminalId={tab.terminal.id}
                                />
                            </View>
                        );
                    })}
                </View>
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
            <TerminalNewSheets state={sheets} />
        </View>
    );
});

const styles = StyleSheet.create({
    root: {
        flex: 1,
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
