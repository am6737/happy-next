import React from 'react';
import { View, TextInput, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface CommandPaletteInputProps {
    value: string;
    onChangeText: (text: string) => void;
    onKeyPress?: (key: string) => boolean;
    inputRef?: React.RefObject<TextInput | null>;
}

export function CommandPaletteInput({ value, onChangeText, onKeyPress, inputRef }: CommandPaletteInputProps) {
    const { theme } = useUnistyles();

    const handleKeyDown = React.useCallback((e: any) => {
        if (Platform.OS === 'web' && onKeyPress) {
            const key = e.nativeEvent.key;
            
            // Handle navigation keys
            if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Home', 'End'].includes(key) && onKeyPress(key)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, [onKeyPress]);

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
        paddingRight: 18,
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
}));
