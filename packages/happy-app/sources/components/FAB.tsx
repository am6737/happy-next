import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { GlassSurface, liquidGlassAvailable } from './GlassSurface';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        position: 'absolute',
        right: 16,
    },
    button: {
        borderRadius: 20,
        width: 56,
        height: 56,
        padding: 16,
    },
    buttonGlass: {
        // A circle, as iOS 26 draws its floating buttons.
        borderRadius: 28,
    },
    shadow: {
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3.84,
        shadowOpacity: theme.colors.shadow.opacity,
        elevation: 5,
    },
    // Not dimmed: glass does not render inside a view that is not fully opaque.
    glassPressed: {
        transform: [{ scale: 0.96 }],
    },
    buttonDefault: {
        backgroundColor: theme.colors.fab.background,
    },
    buttonPressed: {
        backgroundColor: theme.colors.fab.backgroundPressed,
    },
}));

export const FAB = React.memo(({ onPress }: { onPress: () => void }) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    return (
        <View
            style={[
                styles.container,
                { bottom: safeArea.bottom + 16 }
            ]}
        >
            {liquidGlassAvailable ? (
                // iOS 26: glass tinted in the button's colour, so it still reads as the main action.
                <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.glassPressed}>
                    <GlassSurface glass tint={theme.colors.fab.background} style={[styles.button, styles.buttonGlass]}>
                        <Ionicons name="add" size={24} color={theme.colors.fab.icon} />
                    </GlassSurface>
                </Pressable>
            ) : (
                <Pressable
                    style={({ pressed }) => [
                        styles.button,
                        styles.shadow,
                        pressed ? styles.buttonPressed : styles.buttonDefault
                    ]}
                    onPress={onPress}
                >
                    <Ionicons name="add" size={24} color={theme.colors.fab.icon} />
                </Pressable>
            )}
        </View>
    )
});