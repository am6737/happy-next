import * as React from 'react';
import { Pressable, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';

/**
 * Which machine a new terminal should run on.
 *
 * A plain list rather than the app's searchable machine picker: that component
 * carries a search box built on `MultiTextInput`, which a bottom sheet cannot
 * lift above the keyboard the way it does with `BottomSheetTextInput` — and a
 * handful of machines does not need searching anyway.
 *
 * The directory is asked for next, in `FolderPickerSheet`, rather than here:
 * the two questions have different answers to remember, and one sheet asking
 * both would have to nest a second sheet.
 */
export interface NewTerminalSheetProps {
    machines: readonly Machine[];
    /** Named the same way the rest of the strip names them. */
    names: ReadonlyMap<string, string>;
    /** Marked in the list — it is the one most likely to be wanted again. */
    lastUsedMachineId?: string;
    onSelect: (machineId: string) => void;
    /** Fires however the sheet went away, a machine having been picked included. */
    onDismiss?: () => void;
}

export const NewTerminalSheet = React.memo(
    React.forwardRef<BottomSheetModal, NewTerminalSheetProps>(({ machines, names, lastUsedMachineId, onSelect, onDismiss }, ref) => {
        const { theme } = useUnistyles();

        const renderBackdrop = React.useCallback(
            (props: any) => (
                <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
            ),
            [],
        );

        return (
            <BottomSheetModal
                ref={ref}
                snapPoints={['70%']}
                enableDynamicSizing={false}
                backdropComponent={renderBackdrop}
                onDismiss={onDismiss}
                backgroundStyle={{ backgroundColor: theme.colors.surface }}
                handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
            >
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        {t('terminalSession.newTerminal')}
                    </Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {t('wizard.step2Title')}
                    </Text>
                </View>
                <BottomSheetScrollView contentContainerStyle={styles.list}>
                    {machines.map((machine) => {
                        const online = isMachineOnline(machine);
                        const recent = machine.id === lastUsedMachineId;
                        return (
                            <Pressable
                                accessibilityRole="button"
                                key={machine.id}
                                onPress={() => onSelect(machine.id)}
                                style={({ pressed }) => [
                                    styles.row,
                                    pressed && { backgroundColor: theme.colors.surfacePressed },
                                ]}
                            >
                                <View style={styles.rowMain}>
                                    <Text numberOfLines={1} style={[styles.name, { color: theme.colors.text }]}>
                                        {names.get(machine.id) ?? machine.id}
                                    </Text>
                                    <View style={styles.statusRow}>
                                        <View
                                            style={[
                                                styles.dot,
                                                {
                                                    backgroundColor: online
                                                        ? theme.colors.status.connected
                                                        : theme.colors.status.disconnected,
                                                },
                                            ]}
                                        />
                                        <Text style={[styles.status, { color: theme.colors.textSecondary }]}>
                                            {online ? t('wizard.statusOnline') : t('wizard.statusOffline')}
                                        </Text>
                                    </View>
                                </View>
                                {recent ? (
                                    // The app's own mark for somewhere recently used;
                                    // a caption would need words the list has no room for.
                                    <Ionicons name="time-outline" size={18} color={theme.colors.textSecondary} />
                                ) : null}
                            </Pressable>
                        );
                    })}
                    {machines.length === 0 ? (
                        // Reachable: every machine can go offline between opening
                        // this and the list being drawn.
                        <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>
                            {t('wizard.noMachinesAvailable')}
                        </Text>
                    ) : null}
                </BottomSheetScrollView>
            </BottomSheetModal>
        );
    }),
);

const styles = StyleSheet.create((theme) => ({
    header: {
        alignItems: 'center',
        gap: 4,
        paddingBottom: 14,
        paddingTop: 4,
    },
    title: {
        fontSize: 16,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 13,
        ...Typography.default(),
    },
    list: {
        paddingBottom: 24,
        paddingHorizontal: 16,
    },
    row: {
        alignItems: 'center',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
        minHeight: 56,
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    rowMain: {
        flexShrink: 1,
        gap: 3,
    },
    name: {
        fontSize: 15,
        ...Typography.default(),
    },
    statusRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    dot: {
        borderRadius: 4,
        height: 7,
        width: 7,
    },
    status: {
        fontSize: 12,
        ...Typography.default(),
    },
    empty: {
        fontSize: 14,
        paddingVertical: 24,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
