import { memo, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { TerminalTabContextMenu } from './TerminalTabContextMenu';
import { groupTerminalTabsByMachine, type TerminalPanelColors } from './terminalPanel';
import { terminalTabKey, type TerminalTab } from './terminalTabs';

/**
 * The terminals beside the panel, grouped by the machine they run on, the way an editor lists
 * the terminals in its panel once there is more than one.
 */
export interface TerminalPanelListProps {
    tabs: readonly TerminalTab[];
    /** Keyed by `terminalTabKey`. */
    labels: ReadonlyMap<string, string>;
    machineNameById: ReadonlyMap<string, string>;
    activeKey: string | null;
    colors: TerminalPanelColors;
    /** Too narrow for names: icons only, names in tooltips, machine names cut short. */
    compact: boolean;
    onSelect: (tab: TerminalTab) => void;
    onClose: (tab: TerminalTab) => void;
    onDuplicate: (tab: TerminalTab) => void;
    onRename: (tab: TerminalTab) => void;
}

export const TerminalPanelList = memo(({
    tabs,
    labels,
    machineNameById,
    activeKey,
    colors,
    compact,
    onSelect,
    onClose,
    onDuplicate,
    onRename,
}: TerminalPanelListProps) => {
    const groups = useMemo(() => groupTerminalTabsByMachine(tabs), [tabs]);

    return (
        <ScrollView style={styles.list} contentContainerStyle={styles.content}>
            {groups.map((group) => (
                <View key={group.machineId} style={styles.group}>
                    <Text
                        numberOfLines={1}
                        selectable={false}
                        style={[styles.groupTitle, compact && styles.compactGroupTitle, { color: colors.foreground }]}
                    >
                        {machineNameById.get(group.machineId) ?? group.machineId}
                    </Text>
                    {group.tabs.map((tab) => {
                        const key = terminalTabKey(tab);
                        return (
                            <TerminalPanelListRow
                                active={key === activeKey}
                                colors={colors}
                                compact={compact}
                                key={key}
                                label={labels.get(key) ?? tab.terminal.id}
                                onClose={onClose}
                                onDuplicate={onDuplicate}
                                onRename={onRename}
                                onSelect={onSelect}
                                tab={tab}
                            />
                        );
                    })}
                </View>
            ))}
        </ScrollView>
    );
});

const TerminalPanelListRow = memo(({
    tab,
    label,
    active,
    colors,
    compact,
    onSelect,
    onClose,
    onDuplicate,
    onRename,
}: {
    tab: TerminalTab;
    label: string;
    active: boolean;
    colors: TerminalPanelColors;
    compact: boolean;
    onSelect: (tab: TerminalTab) => void;
    onClose: (tab: TerminalTab) => void;
    onDuplicate: (tab: TerminalTab) => void;
    onRename: (tab: TerminalTab) => void;
}) => {
    // Pointer enter and leave rather than the Pressable's hover: moving onto the close button
    // is not leaving the row for them, so the button stays while it is being reached for.
    const [hovered, setHovered] = useState(false);
    const hoverHandlers = Platform.OS === 'web' ? {
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
    } : {};

    // Built per row rather than hoisted: only the one whose menu is actually open reads its items.
    const items: ActionMenuItem[] = [
        { label: t('common.rename'), onPress: () => onRename(tab) },
        { label: t('terminalSession.duplicateTerminal'), onPress: () => onDuplicate(tab) },
        { label: t('terminalSession.closeTerminal'), destructive: true, onPress: () => onClose(tab) },
    ];

    return (
        <TerminalTabContextMenu items={items} title={label}>
            <View {...hoverHandlers}>
                <Pressable
                    // The name is not on screen when compact, so the pointer gets it instead.
                    ref={setTooltip(compact ? label : '')}
                    accessibilityLabel={label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => onSelect(tab)}
                    style={[
                        styles.row,
                        compact && styles.compactRow,
                        active ? { backgroundColor: colors.selected } : hovered ? { backgroundColor: colors.hover } : null,
                    ]}
                >
                    <Ionicons
                        color={colors.foreground}
                        name="terminal-outline"
                        size={13}
                        style={{ opacity: active ? 1 : 0.6 }}
                    />
                    {compact ? null : (
                        <Text
                            numberOfLines={1}
                            selectable={false}
                            style={[styles.rowLabel, { color: colors.foreground, opacity: active ? 1 : 0.7 }]}
                        >
                            {label}
                        </Text>
                    )}
                    {/* Only under the pointer, the way an editor's list keeps its rows quiet. */}
                    {compact || !hovered ? null : (
                        <Pressable
                            ref={setTooltip(t('terminalSession.closeTerminal'))}
                            accessibilityLabel={t('terminalSession.closeTab', { label })}
                            accessibilityRole="button"
                            hitSlop={6}
                            onPress={() => onClose(tab)}
                            style={({ hovered: closeHovered }: any) => [
                                styles.closeButton,
                                closeHovered && { backgroundColor: colors.hover },
                            ]}
                        >
                            <Ionicons color={colors.foreground} name="trash-outline" size={13} style={styles.closeIcon} />
                        </Pressable>
                    )}
                </Pressable>
            </View>
        </TerminalTabContextMenu>
    );
});

// Web shows the label as the browser's tooltip; react-native-web drops `title` from props.
export function setTooltip(label: string) {
    return (element: any) => {
        if (Platform.OS === 'web' && element && typeof element === 'object') element.title = label;
    };
}

const styles = StyleSheet.create({
    list: {
        flex: 1,
    },
    content: {
        gap: 8,
        paddingHorizontal: 6,
        paddingVertical: 6,
    },
    group: {
        gap: 1,
    },
    groupTitle: {
        fontSize: 11,
        fontWeight: '600',
        opacity: 0.6,
        paddingBottom: 2,
        paddingHorizontal: 6,
        textTransform: 'uppercase',
    },
    row: {
        alignItems: 'center',
        borderRadius: 4,
        flexDirection: 'row',
        gap: 6,
        minHeight: 26,
        paddingLeft: 8,
        paddingRight: 4,
        paddingVertical: 3,
    },
    compactRow: {
        justifyContent: 'center',
        paddingLeft: 0,
        paddingRight: 0,
    },
    compactGroupTitle: {
        paddingHorizontal: 0,
        textAlign: 'center',
    },
    rowLabel: {
        flex: 1,
        fontFamily: 'Menlo',
        fontSize: 12,
    },
    closeButton: {
        alignItems: 'center',
        borderRadius: 3,
        justifyContent: 'center',
        padding: 2,
    },
    closeIcon: {
        opacity: 0.8,
    },
});
