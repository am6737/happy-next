import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/**
 * The tint a pressed row or card shows, laid over its own background (which stays, so a selected or
 * coloured row keeps its colour under it). Put it first among the pressable's children, so the
 * content draws above it; `style` takes the pressable's corner radii.
 */
export const PressHighlight = React.memo(({ style }: { style?: StyleProp<ViewStyle> }) => (
    <View pointerEvents="none" style={[styles.highlight, style]} />
));
PressHighlight.displayName = 'PressHighlight';

const styles = StyleSheet.create((theme) => ({
    highlight: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.surfaceRipple,
    },
}));
