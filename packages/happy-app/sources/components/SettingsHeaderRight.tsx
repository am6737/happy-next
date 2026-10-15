import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { t } from '@/text';

export const SettingsHeaderRight = React.memo(({ onScanPress, onManualEntryPress, isLoading }: {
    onScanPress: () => void;
    onManualEntryPress: () => void;
    isLoading: boolean;
}) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const showServerButton = isUsingCustomServer();
    const isWeb = Platform.OS === 'web';

    return (
        <View style={styles.buttons}>
            <Pressable
                onPress={isWeb ? onManualEntryPress : onScanPress}
                disabled={isLoading}
                hitSlop={15}
                accessibilityRole="button"
                accessibilityLabel={isWeb ? t('connect.enterUrlManually') : t('settings.scanQrCodeToAuthenticate')}
                accessibilityState={{ disabled: isLoading, busy: isLoading }}
                style={[styles.button, showServerButton && styles.leadingButton]}
            >
                {isLoading
                    ? <ActivityIndicator size="small" color={theme.colors.header.tint} />
                    : <Ionicons name={isWeb ? 'link-outline' : 'scan-outline'} size={Platform.OS === "android" ? 22 : 24} color={theme.colors.header.tint} />}
            </Pressable>
            {showServerButton && (
                <Pressable
                    onPress={() => router.push('/server')}
                    hitSlop={15}
                    accessibilityRole="button"
                    accessibilityLabel={t('server.serverConfiguration')}
                    style={styles.button}
                >
                    <Ionicons name="server-outline" size={24} color={theme.colors.header.tint} />
                </Pressable>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    buttons: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    button: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
    },
    leadingButton: {
        marginRight: Platform.OS === 'web' ? 8 : 4,
    },
});
