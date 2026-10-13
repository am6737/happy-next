import React from 'react';
import { View, TextInput, Platform, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface CommandPaletteInputProps {
    value: string;
    onChangeText: (text: string) => void;
    onKeyPress?: (key: string) => boolean;
    inputRef?: React.RefObject<TextInput | null>;
    hasHistory?: boolean;
    isHistoryOpen?: boolean;
    onToggleHistory?: () => void;
}

export function CommandPaletteInput({ value, onChangeText, onKeyPress, inputRef, hasHistory = false, isHistoryOpen = false, onToggleHistory }: CommandPaletteInputProps) {
    const { theme } = useUnistyles();

    const handleKeyDown = React.useCallback((e: any) => {
        if (Platform.OS === 'web' && onKeyPress) {
            const key = e.nativeEvent.key;
            
            // Handle navigation keys
            if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Home', 'End'].includes(key) && onKeyPress(key)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, [onKeyPress]);

    // Keep typing focus in the input after tapping the history button
    const handleToggleHistory = React.useCallback(() => {
        onToggleHistory?.();
        inputRef?.current?.focus();
    }, [inputRef, onToggleHistory]);

    return (
        <View style={styles.container}>
            <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
            <TextInput
                ref={inputRef}
                style={[styles.input, Typography.default()]}
                value={value}
                onChangeText={onChangeText}
                placeholder={t('commandPalette.placeholder')}
                placeholderTextColor={theme.colors.textSecondary}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="go"
                onKeyPress={handleKeyDown}
                blurOnSubmit={false}
            />
            <View style={styles.actions}>
                {hasHistory && (
                    <Pressable
                        onPress={handleToggleHistory}
                        hitSlop={6}
                        // react-native-web also reports hovered; the icon stays faint until pointed at or open
                        style={({ pressed, hovered }: any) => [styles.actionButton, Platform.OS === 'web' && !hovered && !isHistoryOpen && styles.actionIdle, isHistoryOpen && styles.actionActive, pressed && styles.actionPressed]}
                        accessibilityRole="button"
                        accessibilityLabel={t('commandPalette.searchHistory')}
                        accessibilityState={{ expanded: isHistoryOpen }}
                    >
                        <Ionicons name="time-outline" size={19} color={isHistoryOpen ? theme.colors.textLink : theme.colors.textSecondary} />
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 18,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    input: {
        flex: 1,
        paddingLeft: 10,
        paddingRight: 8,
        paddingVertical: 14,
        fontSize: 17,
        color: theme.colors.text,
        letterSpacing: -0.3,
        // Remove outline on web
        ...(Platform.OS === 'web' ? {
            outlineStyle: 'none',
            outlineWidth: 0,
        } as any : {}),
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 10,
    },
    actionButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionIdle: {
        opacity: 0.45,
    },
    actionActive: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    actionPressed: {
        opacity: 0.6,
    },
}));
