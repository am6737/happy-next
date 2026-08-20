import * as React from 'react';
import { GestureResponderEvent, Pressable, StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export type IconButtonSize = 'small' | 'normal' | 'medium' | 'large';
export type IconButtonDisplay = 'plain' | 'outline' | 'filled';

const dimensions: Record<IconButtonSize, number> = {
    small: 32,
    normal: 40,
    medium: 44,
    large: 48,
};

const stylesheet = StyleSheet.create((theme) => ({
    base: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    pressed: {
        opacity: 0.72,
    },
    disabled: {
        opacity: 0.45,
    },
    plain: {
        backgroundColor: theme.colors.transparent,
        borderColor: theme.colors.transparent,
    },
    outline: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.divider,
    },
    filled: {
        backgroundColor: theme.colors.surfaceHigh,
        borderColor: theme.colors.transparent,
    },
}));

export const IconButton = React.memo((props: {
    icon: React.ReactNode;
    accessibilityLabel: string;
    onPress: (event: GestureResponderEvent) => void;
    size?: IconButtonSize;
    display?: IconButtonDisplay;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    hitSlop?: number;
}) => {
    const styles = stylesheet;
    const size = dimensions[props.size ?? 'normal'];
    const display = props.display ?? 'plain';

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            disabled={props.disabled}
            hitSlop={props.hitSlop ?? 8}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.base,
                styles[display],
                { width: size, height: size, borderRadius: Math.round(size * 0.29), borderWidth: display === 'outline' ? 1 : 0 },
                pressed && styles.pressed,
                props.disabled && styles.disabled,
                props.style,
            ]}
        >
            {props.icon}
        </Pressable>
    );
});
