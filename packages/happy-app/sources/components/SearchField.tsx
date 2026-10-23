import * as React from 'react';
import { View, TextInput, Pressable, Platform, ActivityIndicator, type StyleProp, type ViewStyle, type TextInputProps } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { sheetFill } from './glassSheet';

// The app's search field, on every platform the iOS system one: 36 tall, corners of 10, its text
// a size down from the system's 17, at 16.
export const searchFieldMetrics = {
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 8,
    gap: 6,
    iconSize: 17,
    fontSize: 16,
};

export interface SearchFieldProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    // What the × does; clearing the text by default.
    onClear?: () => void;
    onSubmitEditing?: () => void;
    onEndEditing?: () => void;
    autoFocus?: boolean;
    inputRef?: React.Ref<TextInput>;
    style?: StyleProp<ViewStyle>;
    returnKeyType?: TextInputProps['returnKeyType'];
    editable?: boolean;
    // A search still running: a spinner in place of the ×.
    loading?: boolean;
    // In a bottom sheet, whose input has to tell it about the keyboard (the plain one on the web).
    inSheet?: boolean;
}

export const SearchField = React.memo(({ value, onChangeText, placeholder, onClear, onSubmitEditing, onEndEditing, autoFocus, inputRef, style, returnKeyType = 'search', editable, loading, inSheet }: SearchFieldProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const Input = inSheet && Platform.OS !== 'web' ? BottomSheetTextInput : TextInput;

    return (
        <View style={[styles.field, inSheet && styles.fieldInSheet, style]}>
            <Ionicons name="search" size={searchFieldMetrics.iconSize} color={theme.colors.textSecondary} />
            <Input
                ref={inputRef as any}
                style={styles.input}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.textSecondary}
                onSubmitEditing={onSubmitEditing}
                onEndEditing={onEndEditing}
                autoFocus={autoFocus}
                editable={editable}
                returnKeyType={returnKeyType}
                autoCorrect={false}
                autoCapitalize="none"
                underlineColorAndroid="transparent"
            />
            {loading ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : value.length > 0 && (
                <Pressable
                    onPress={onClear ?? (() => onChangeText(''))}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.clear')}
                >
                    <Ionicons name="close-circle" size={searchFieldMetrics.iconSize} color={theme.colors.textSecondary} />
                </Pressable>
            )}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    field: {
        height: searchFieldMetrics.height,
        flexDirection: 'row',
        alignItems: 'center',
        gap: searchFieldMetrics.gap,
        paddingHorizontal: searchFieldMetrics.paddingHorizontal,
        borderRadius: searchFieldMetrics.borderRadius,
        backgroundColor: theme.colors.surface,
    },
    fieldInSheet: {
        backgroundColor: sheetFill(theme.colors.surface),
    },
    input: {
        flex: 1,
        height: '100%',
        padding: 0,
        margin: 0,
        fontSize: searchFieldMetrics.fontSize,
        color: theme.colors.text,
        textAlignVertical: 'center',
        includeFontPadding: false,
        ...Typography.default(),
        ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } as any : null),
    },
}));
