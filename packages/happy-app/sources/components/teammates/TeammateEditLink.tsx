import React from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { useTeammate } from '@/sync/storage';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/** Profile header action: opens the edit flow unless the Agent is archived. */
export function TeammateEditLink({ id }: { id: string }) {
    const router = useRouter();
    const teammate = useTeammate(id);
    if (!teammate || teammate.status === 'archived') return null;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('teammates.wizard.edit')} hitSlop={12} onPress={() => router.push(`/teammates/${encodeURIComponent(id)}/edit`)}>
            <Text style={styles.label}>{t('teammates.wizard.edit')}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    label: { ...Typography.default('semiBold'), fontSize: 16, color: theme.colors.textLink },
}));
