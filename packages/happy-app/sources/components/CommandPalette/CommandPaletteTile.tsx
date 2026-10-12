import React from 'react';
import { ActivityIndicator, View, Text, Pressable, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Command } from './types';
import { Typography } from '@/constants/Typography';

interface CommandPaletteTileProps {
    command: Command;
    isSelected: boolean;
    onPress: () => void;
    onHover?: () => void;
    isExecuting?: boolean;
}

export function CommandPaletteTile({ command, isSelected, onPress, onHover, isExecuting = false }: CommandPaletteTileProps) {
    const { theme } = useUnistyles();
    const [isHovered, setIsHovered] = React.useState(false);

    const pressableProps: any = {
        style: ({ pressed }: any) => [
            styles.container,
            isSelected && styles.selected,
            isHovered && !isSelected && styles.hovered,
            pressed && Platform.OS === 'web' && styles.pressed,
        ],
        onPress,
        disabled: isExecuting,
        accessibilityRole: 'button',
        accessibilityLabel: command.title,
        accessibilityHint: command.subtitle,
    };

    // Add mouse events only on web
    if (Platform.OS === 'web') {
        pressableProps.onMouseEnter = () => {
            setIsHovered(true);
            onHover?.();
        };
        pressableProps.onMouseLeave = () => setIsHovered(false);
    }

    return (
        <Pressable {...pressableProps}>
            <View style={styles.iconContainer}>
                {isExecuting ? (
                    <ActivityIndicator size="small" color={theme.colors.textLink} />
                ) : (
                    <Ionicons
                        name={command.icon as any}
                        size={18}
                        color={isSelected ? theme.colors.textLink : theme.colors.textSecondary}
                    />
                )}
            </View>
            <Text numberOfLines={1} style={[styles.title, Typography.default()]}>
                {command.title}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    // Same anatomy as a list row (icon box + title), so tiles and rows read as one list laid out in columns
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderRadius: 8,
    },
    selected: {
        backgroundColor: theme.dark ? 'rgba(10, 132, 255, 0.16)' : 'rgba(0, 122, 255, 0.09)',
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    hovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        letterSpacing: -0.2,
    },
}));
