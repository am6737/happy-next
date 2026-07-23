import React from 'react';
import { ActivityIndicator, View, Text, Pressable, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Command } from './types';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { splitCommandHighlightSegments } from './highlight';

interface CommandPaletteItemProps {
    command: Command;
    isSelected: boolean;
    onPress: () => void;
    onHover?: () => void;
    isExecuting?: boolean;
    searchQuery?: string;
}

export function CommandPaletteItem({ command, isSelected, onPress, onHover, isExecuting = false, searchQuery = '' }: CommandPaletteItemProps) {
    const { theme } = useUnistyles();
    const [isHovered, setIsHovered] = React.useState(false);
    
    const handleMouseEnter = React.useCallback(() => {
        if (Platform.OS === 'web') {
            setIsHovered(true);
            onHover?.();
        }
    }, [onHover]);
    
    const handleMouseLeave = React.useCallback(() => {
        if (Platform.OS === 'web') {
            setIsHovered(false);
        }
    }, []);
    
    const pressableProps: any = {
        style: ({ pressed }: any) => [
            styles.container,
            isSelected && styles.selected,
            isHovered && !isSelected && styles.hovered,
            pressed && Platform.OS === 'web' && styles.pressed
        ],
        onPress,
        disabled: isExecuting,
        accessibilityRole: 'button',
        accessibilityLabel: command.title,
    };
    
    // Add mouse events only on web
    if (Platform.OS === 'web') {
        pressableProps.onMouseEnter = handleMouseEnter;
        pressableProps.onMouseLeave = handleMouseLeave;
    }

    const renderHighlightedText = (value: string) => {
        if (Platform.OS !== 'web' || !searchQuery.trim()) return value;
        return splitCommandHighlightSegments(value, searchQuery).map((segment, index) => (
            segment.highlighted
                ? <Text key={`${index}-${segment.text}`} style={styles.highlight}>{segment.text}</Text>
                : segment.text
        ));
    };
    
    return (
        <Pressable {...pressableProps}>
            <View style={styles.content}>
                {command.icon && (
                    <View style={styles.iconContainer}>
                        <Ionicons 
                            name={command.icon as any} 
                            size={20} 
                            color={isSelected ? theme.colors.textLink : theme.colors.textSecondary}
                        />
                    </View>
                )}
                <View style={styles.textContainer}>
                    <Text style={[styles.title, command.dangerous && styles.dangerousText, Typography.default()]}>
                        {renderHighlightedText(command.title)}
                    </Text>
                    {command.subtitle && (
                        <Text style={[styles.subtitle, Typography.default()]}>
                            {renderHighlightedText(command.subtitle)}
                        </Text>
                    )}
                </View>
                {command.badge && (
                    <View style={[
                        styles.badge,
                        command.badgeTone === 'success' && styles.badgeSuccess,
                        command.badgeTone === 'warning' && styles.badgeWarning,
                        command.badgeTone === 'accent' && styles.badgeAccent,
                    ]}>
                        <Text style={[
                            styles.badgeText,
                            command.badgeTone === 'success' && styles.badgeTextSuccess,
                            command.badgeTone === 'warning' && styles.badgeTextWarning,
                            command.badgeTone === 'accent' && styles.badgeTextAccent,
                            Typography.default('semiBold'),
                        ]}>
                            {command.badge}
                        </Text>
                    </View>
                )}
                {isExecuting ? (
                    <ActivityIndicator size="small" color={theme.colors.textLink} />
                ) : command.shortcut ? (
                    <View style={styles.shortcutContainer}>
                        <Text style={[styles.shortcut, Typography.mono()]}>
                            {command.shortcut}
                        </Text>
                    </View>
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        backgroundColor: 'transparent',
        marginHorizontal: 8,
        marginVertical: 2,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    selected: {
        backgroundColor: theme.dark ? 'rgba(10, 132, 255, 0.14)' : 'rgba(0, 122, 255, 0.08)',
        borderColor: theme.dark ? 'rgba(10, 132, 255, 0.28)' : 'rgba(0, 122, 255, 0.13)',
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    hovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
        marginRight: 12,
    },
    title: {
        fontSize: 15,
        color: theme.colors.text,
        marginBottom: 2,
        letterSpacing: -0.2,
    },
    subtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        letterSpacing: -0.1,
    },
    shortcutContainer: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 6,
    },
    shortcut: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    dangerousText: {
        color: theme.colors.textDestructive,
    },
    badge: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        marginRight: 10,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHighest,
    },
    badgeSuccess: {
        backgroundColor: theme.dark ? 'rgba(50, 215, 75, 0.14)' : 'rgba(52, 199, 89, 0.12)',
    },
    badgeWarning: {
        backgroundColor: theme.dark ? 'rgba(255, 159, 10, 0.16)' : 'rgba(255, 149, 0, 0.13)',
    },
    badgeAccent: {
        backgroundColor: theme.dark ? 'rgba(10, 132, 255, 0.16)' : 'rgba(0, 122, 255, 0.11)',
    },
    badgeText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
    },
    badgeTextSuccess: {
        color: theme.colors.success,
    },
    badgeTextWarning: {
        color: theme.dark ? '#FF9F0A' : '#C56500',
    },
    badgeTextAccent: {
        color: theme.colors.textLink,
    },
    highlight: {
        color: theme.dark ? '#FFD60A' : '#8A5200',
        backgroundColor: theme.dark ? 'rgba(255, 214, 10, 0.18)' : 'rgba(255, 204, 0, 0.24)',
        fontWeight: '700',
        borderRadius: 3,
    },
}));
