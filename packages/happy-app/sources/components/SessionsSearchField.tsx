import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { searchFieldMetrics } from './SearchField';

// A search field at the top of the phone session list, drawn as `SearchField`. Not an input: a tap
// opens the search page, the phone's counterpart of the sidebar's command palette.
export const SessionsSearchField = React.memo(() => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();

    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="search"
                accessibilityLabel={t('commandPalette.placeholder')}
                onPress={() => router.push('/search')}
                style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
            >
                <Ionicons name="search" size={searchFieldMetrics.iconSize} color={theme.colors.textSecondary} />
                <Text style={styles.placeholder} numberOfLines={1}>{t('sessionScope.search')}</Text>
            </Pressable>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        paddingTop: 12,
        // With the list's own top padding, the gap to the first card is the 16 between cards.
        paddingBottom: 8,
        // In line with the session cards below.
        paddingHorizontal: Platform.select({ ios: 16, default: 12 }),
        backgroundColor: theme.colors.groupped.background,
    },
    field: {
        height: searchFieldMetrics.height,
        flexDirection: 'row',
        alignItems: 'center',
        gap: searchFieldMetrics.gap,
        paddingHorizontal: searchFieldMetrics.paddingHorizontal,
        borderRadius: searchFieldMetrics.borderRadius,
        backgroundColor: theme.colors.surface,
    },
    fieldPressed: {
        opacity: 0.7,
    },
    placeholder: {
        flex: 1,
        fontSize: searchFieldMetrics.fontSize,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
