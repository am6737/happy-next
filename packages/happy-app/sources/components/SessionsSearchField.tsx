import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useRouter } from 'expo-router';

const FIELD_HEIGHT = Platform.select({ ios: 36, default: 40 });

// A search field at the top of the phone session list. Not an input: a tap opens the search page,
// the phone's counterpart of the sidebar's command palette.
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
                <Ionicons name="search" size={17} color={theme.colors.textSecondary} />
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
        height: FIELD_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: Platform.select({ ios: 8, default: 16 }),
        borderRadius: Platform.select({ ios: 10, default: FIELD_HEIGHT / 2 }),
        backgroundColor: theme.colors.surface,
    },
    fieldPressed: {
        opacity: 0.7,
    },
    placeholder: {
        flex: 1,
        fontSize: Platform.select({ ios: 17, default: 15 }),
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
