import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { t } from '@/text';
import type { DownloadProgress } from './downloadFile';

export function FileDownloadProgress({ progress, onCancel }: {
    progress: DownloadProgress | null;
    onCancel: () => void;
}) {
    const { theme } = useUnistyles();
    if (!progress) return null;
    const percent = progress.total === null ? null : progress.total === 0 ? 100 : Math.floor(progress.received / progress.total * 100);
    return (
        <View style={{ width: '100%', paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" />
                <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: theme.colors.text, fontSize: 13 }}>
                    {t('files.preview.download')} {percent === null ? t('files.preview.loading') : `${percent}% (${(progress.received / 1048576).toFixed(1)} / ${(progress.total! / 1048576).toFixed(1)} MiB)`}
                </Text>
                <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel={t('common.cancel')}
                    {...(Platform.OS === 'web' ? { title: t('common.cancel') } : {})}
                    style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close-outline" size={20} color={theme.colors.text} />
                </Pressable>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel={t('files.preview.download')}
                accessibilityValue={{ min: 0, max: 100, ...(percent === null ? {} : { now: percent }) }}
                {...(Platform.OS === 'web' ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent ?? undefined } : {})}
                style={{ height: 2, backgroundColor: theme.colors.divider }}>
                <View style={{ height: 2, width: `${percent ?? 0}%`, backgroundColor: theme.colors.textLink }} />
            </View>
        </View>
    );
}
