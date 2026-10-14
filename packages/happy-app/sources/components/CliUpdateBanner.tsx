import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';

/** A small pill floating at the top of a chat, centered. */
export const FloatingPill = React.memo(({ top, tone, icon, text, onPress, onDismiss }: {
    top: number;
    tone: 'warning' | 'error';
    icon: React.ComponentProps<typeof Ionicons>['name'];
    text: string;
    onPress: () => void;
    onDismiss?: () => void;
}) => {
    const { theme } = useUnistyles();
    const colors = theme.colors.box[tone];
    return (
        <View style={[styles.pill, { top, backgroundColor: colors.background, borderColor: colors.border }]}>
            <Pressable style={styles.body} onPress={onPress} hitSlop={6}>
                <Ionicons name={icon} size={14} color={colors.text} />
                <Text style={[styles.text, { color: colors.text }]} numberOfLines={1}>{text}</Text>
            </Pressable>
            {onDismiss && (
                <Pressable onPress={onDismiss} hitSlop={10} style={styles.close}>
                    <Ionicons name="close" size={14} color={colors.text} />
                </Pressable>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    pill: {
        position: 'absolute',
        alignSelf: 'center',
        maxWidth: '90%',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 100,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingVertical: 7,
        zIndex: 998,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    body: {
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    text: {
        flexShrink: 1,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    close: {
        marginLeft: 8,
    },
}));
