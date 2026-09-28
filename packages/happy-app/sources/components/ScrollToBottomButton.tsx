import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { GlassSurface, liquidGlassAvailable } from './GlassSurface';

/**
 * The round button that jumps a chat back to its newest message, with the count of messages that
 * arrived while the reader was up in the history. On iOS 26 it is glass, like the composer below it.
 */
export const ScrollToBottomButton = React.memo(({ onPress, unreadCount }: { onPress: () => void; unreadCount: number }) => {
    const { theme } = useUnistyles();
    return (
        <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
            <GlassSurface
                glass={liquidGlassAvailable}
                color={theme.colors.surfaceHighest}
                style={[styles.button, !liquidGlassAvailable && styles.shadow]}
            >
                <Ionicons name="chevron-down" size={24} color={theme.colors.text} />
            </GlassSurface>
            {unreadCount > 0 && (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
            )}
        </Pressable>
    );
});
ScrollToBottomButton.displayName = 'ScrollToBottomButton';

const styles = StyleSheet.create((theme) => ({
    button: {
        borderRadius: 20,
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    shadow: {
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 4,
        elevation: 4,
    },
    pressed: {
        opacity: 0.7,
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: theme.colors.status.connected,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    badgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
}));
