import { memo, useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { useTerminalTabReorder } from '@/hooks/useTerminalTabReorder';
import { TerminalTabContextMenu } from './TerminalTabContextMenu';
import { terminalTabKey, type TerminalTab } from './terminalTabs';

/**
 * The row of open terminals.
 *
 * One tab per live terminal rather than one window each: terminals share a
 * connection and a strip keeps them together without the window management a
 * window per shell would demand. The strip spans machines, so the labels are
 * resolved by the caller — it is the only place that can see when two of them
 * would read the same.
 *
 * The strip draws no background of its own: it is placed either on the window's
 * title row or under a header, and both of those already have one.
 *
 * On the web the tabs can be dragged into a different order. Everywhere else
 * they cannot: a finger on a tab opens the context menu, so there would be no
 * gesture left to drag with.
 *
 * The strip is sized to fit the title row it stands in for in the desktop
 * terminal window (see `TerminalWindowTitleRow`), which is why the padding
 * looks tight for a bare page — anything taller is clipped by that row.
 */
export interface TerminalTabBarProps {
    tabs: readonly TerminalTab[];
    /** Keyed by `terminalTabKey`, since a terminal id is only unique per machine. */
    labels: ReadonlyMap<string, string>;
    activeKey: string | null;
    onSelect: (tab: TerminalTab) => void;
    onClose: (tab: TerminalTab) => void;
    onDuplicate: (tab: TerminalTab) => void;
    /** Asks for a name for this tab, which the caller gets and keeps. */
    onRename: (tab: TerminalTab) => void;
    onNew: () => void;
    /** The whole strip in its new order, once a drag settles. */
    onReorder: (order: readonly string[]) => void;
    isBusy?: boolean;
}

/** Space before the first tab, and between tabs. Reordering is placed by these. */
const STRIP_LEADING = 6;
const STRIP_GAP = 4;
/**
 * The tallest tab plus twice the vertical padding has to come to the title row's
 * 38px, or that row clips the bottom of every tab. Not roomier, because the
 * strip stands in for the title bar of the desktop terminal window.
 */
const STRIP_PADDING_VERTICAL = 3;

export const TerminalTabBar = memo(({
    tabs,
    labels,
    activeKey,
    onSelect,
    onClose,
    onDuplicate,
    onRename,
    onNew,
    onReorder,
    isBusy = false,
}: TerminalTabBarProps) => {
    const { theme } = useUnistyles();
    const scrollRef = useRef<ScrollView>(null);
    const reorder = useTerminalTabReorder({
        tabs,
        enabled: Platform.OS === 'web',
        onReorder,
        leading: STRIP_LEADING,
        gap: STRIP_GAP,
    });

    const lastTab = reorder.renderTabs[reorder.renderTabs.length - 1];
    const lastKey = lastTab ? terminalTabKey(lastTab) : null;

    // A terminal that was just started is the last tab in the strip, which is
    // the one place a strip with more tabs than fit cannot show — so the tab
    // would arrive and look like it never did. Bringing that end into view when
    // it becomes the active tab is what makes starting one look like it worked.
    useEffect(() => {
        if (!activeKey || activeKey !== lastKey) {
            return;
        }
        scrollRef.current?.scrollToEnd({ animated: true });
    }, [activeKey, lastKey]);

    return (
        <ScrollView
            horizontal
            ref={scrollRef}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.content}
            style={styles.bar}
            keyboardShouldPersistTaps="always"
            onScroll={reorder.onBarScroll}
            scrollEventThrottle={16}
        >
            {reorder.renderTabs.map((tab) => {
                const key = terminalTabKey(tab);
                const label = labels.get(key) ?? tab.terminal.id;
                const active = key === activeKey;
                const dragging = key === reorder.draggingKey;
                // Built per tab rather than hoisted: only the one whose menu is
                // actually open reads its items.
                const items: ActionMenuItem[] = [
                    { label: t('common.rename'), onPress: () => onRename(tab) },
                    { label: t('terminalSession.duplicateTerminal'), onPress: () => onDuplicate(tab) },
                    { label: t('terminalSession.closeTerminal'), destructive: true, onPress: () => onClose(tab) },
                ];
                return (
                    <TerminalTabContextMenu items={items} key={key} title={label}>
                        <Pressable
                            {...reorder.tabProps(key)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            onPress={() => onSelect(tab)}
                            style={[
                                styles.tab,
                                { backgroundColor: active ? theme.colors.surfaceHighest : 'transparent' },
                                // While dragged the tab is carried under the
                                // pointer and lifted off the strip, so it reads
                                // as the thing being moved rather than as one
                                // that has already landed.
                                dragging && {
                                    backgroundColor: theme.colors.surfaceHighest,
                                    elevation: 8,
                                    opacity: 0.95,
                                    shadowColor: theme.colors.shadow.color,
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.28,
                                    shadowRadius: 10,
                                    transform: [{ translateX: reorder.dragOffsetX }],
                                    zIndex: 20,
                                },
                            ]}
                        >
                            {/* A tab's name is a label, not something to copy.
                                Said with `selectable` rather than a
                                `userSelect` style: WebKit honours only the
                                prefixed property, which the style layer does
                                not emit, so a press that drifts by a pixel
                                would leave the tab looking selected. */}
                            <Text
                                numberOfLines={1}
                                selectable={false}
                                style={[styles.tabLabel, { color: theme.colors.text, opacity: active ? 1 : 0.65 }]}
                            >
                                {label}
                            </Text>
                            <Pressable
                                accessibilityLabel={t('terminalSession.closeTab', { label })}
                                accessibilityRole="button"
                                hitSlop={8}
                                onPress={() => onClose(tab)}
                            >
                                <Ionicons
                                    color={theme.colors.text}
                                    name="close"
                                    size={13}
                                    style={styles.closeIcon}
                                />
                            </Pressable>
                        </Pressable>
                    </TerminalTabContextMenu>
                );
            })}
            {/* Disabled while a spawn is in flight so a slow round trip does
                not queue up a terminal per tap. */}
            <Pressable
                accessibilityLabel={t('terminalSession.newTerminal')}
                accessibilityRole="button"
                disabled={isBusy}
                onPress={onNew}
                style={[styles.newButton, isBusy && styles.newButtonBusy]}
            >
                <Ionicons color={theme.colors.text} name="add" size={18} />
            </Pressable>
        </ScrollView>
    );
});

const styles = StyleSheet.create({
    bar: {
        alignSelf: 'stretch',
        flexGrow: 0,
        flexShrink: 1,
    },
    content: {
        alignItems: 'center',
        gap: STRIP_GAP,
        paddingHorizontal: STRIP_LEADING,
        paddingVertical: STRIP_PADDING_VERTICAL,
    },
    tab: {
        alignItems: 'center',
        borderRadius: 6,
        flexDirection: 'row',
        gap: 6,
        maxWidth: 180,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    tabLabel: {
        flexShrink: 1,
        fontFamily: 'Menlo',
        fontSize: 12,
    },
    closeIcon: {
        opacity: 0.7,
    },
    newButton: {
        alignItems: 'center',
        borderRadius: 6,
        justifyContent: 'center',
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    newButtonBusy: {
        opacity: 0.4,
    },
});
