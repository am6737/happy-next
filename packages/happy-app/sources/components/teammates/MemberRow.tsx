import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import type { Teammate } from 'happy-wire';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { TeammateAvatar } from './ui';

/** A selectable Agent row: avatar, name and role, with a round check on the right. */
export const MemberRow = React.memo(function MemberRow({ teammate, checked, disabled, onToggle }: {
    teammate: Teammate;
    checked: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: checked, disabled }} disabled={disabled} onPress={onToggle}
            style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}>
            <TeammateAvatar teammate={teammate} size={40} />
            <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>{teammate.name}</Text>
                {!!teammate.role && <Text style={styles.role} numberOfLines={1}>{teammate.role}</Text>}
            </View>
            <View style={[styles.indicator, checked && styles.indicatorSelected]}>
                {checked && <Ionicons name="checkmark" size={15} color={theme.colors.button.primary.tint} />}
            </View>
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
    },
    text: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    role: {
        ...Typography.default(),
        marginTop: 2,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    indicator: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: theme.colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
    },
    indicatorSelected: {
        borderWidth: 0,
        backgroundColor: theme.colors.button.primary.background,
    },
    disabled: {
        opacity: 0.45,
    },
    pressed: {
        opacity: 0.7,
    },
}));
