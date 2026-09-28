import * as React from 'react';
import { View, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { GlassSurface, liquidGlassAvailable } from './GlassSurface';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
    },
    button: {
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonGlass: {
        // A capsule, as iOS 26 draws its floating buttons.
        borderRadius: 28,
    },
    shadow: {
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3.84,
        shadowOpacity: theme.colors.shadow.opacity,
        elevation: 5,
    },
    glassPressed: {
        opacity: 0.8,
    },
    buttonDefault: {
        backgroundColor: theme.colors.fab.background,
    },
    buttonPressed: {
        backgroundColor: theme.colors.fab.backgroundPressed,
    },
    text: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.fab.icon,
    },
}));

export const FABWide = React.memo(({ onPress }: { onPress: () => void }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
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
                        <Text style={styles.text}>{t('newSession.title')}</Text>
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
                    <Text style={styles.text}>{t('newSession.title')}</Text>
                </Pressable>
            )}
        </View>
    )
});