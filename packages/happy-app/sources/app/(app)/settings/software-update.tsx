import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Text } from '@/components/StyledText';
import {
    getDesktopUpdateSnapshot,
    installDesktopUpdateAndRelaunch,
    prepareDesktopUpdate,
    subscribeToDesktopUpdate,
} from '@/desktop/desktopUpdater';
import { desktopUpdateProgress } from '@/desktop/desktopUpdaterUtils';
import { Modal } from '@/modal';
import { t } from '@/text';

export default function SoftwareUpdateScreen() {
    const { theme } = useUnistyles();
    const update = React.useSyncExternalStore(
        subscribeToDesktopUpdate,
        getDesktopUpdateSnapshot,
        getDesktopUpdateSnapshot,
    );
    const progress = desktopUpdateProgress(update);

    React.useEffect(() => {
        if (update.phase === 'idle') {
            void prepareDesktopUpdate();
        }
    }, [update.phase]);

    const status = update.phase === 'checking'
        ? t('desktopUpdate.checking')
        : update.phase === 'upToDate'
            ? t('desktopUpdate.upToDate')
            : update.phase === 'available'
                ? t('desktopUpdate.available', { version: update.availableVersion ?? '' })
                : update.phase === 'downloading'
                    ? progress === null
                        ? t('desktopUpdate.downloading')
                        : t('desktopUpdate.downloadingProgress', { progress: Math.round(progress * 100) })
                    : update.phase === 'downloaded'
                        ? t('desktopUpdate.ready')
                        : update.phase === 'installing'
                            ? t('desktopUpdate.installing')
                            : update.phase === 'installError'
                                ? t('desktopUpdate.failed')
                                : update.phase === 'unsupported'
                                    ? t('desktopUpdate.productionOnly')
                                    : update.phase === 'error'
                                        ? t('desktopUpdate.failed')
                                        : t('desktopUpdate.notChecked');

    const prepare = async () => {
        const result = await prepareDesktopUpdate();
        if (result.phase === 'error') {
            Modal.alert(t('desktopUpdate.failed'), t('desktopUpdate.tryAgain'));
        }
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup title={t('desktopUpdate.title')} footer={t('desktopUpdate.footer')}>
                <Item
                    title={t('desktopUpdate.currentVersion')}
                    detail={update.currentVersion ?? '—'}
                    showChevron={false}
                />
                <Item
                    title={t('desktopUpdate.status')}
                    subtitle={update.phase === 'error' || update.phase === 'installError' ? update.error : undefined}
                    detail={status}
                    showChevron={false}
                />
                {update.phase === 'downloading' && (
                    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                        <View
                            style={{
                                height: 6,
                                borderRadius: 3,
                                overflow: 'hidden',
                                backgroundColor: theme.colors.divider,
                            }}
                        >
                            <View
                                style={{
                                    width: `${Math.round((progress ?? 0.08) * 100)}%`,
                                    height: '100%',
                                    borderRadius: 3,
                                    backgroundColor: '#007AFF',
                                }}
                            />
                        </View>
                    </View>
                )}
            </ItemGroup>

            {update.releaseNotes && (
                <ItemGroup title={t('desktopUpdate.releaseNotes')}>
                    <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                            {update.releaseNotes}
                        </Text>
                    </View>
                </ItemGroup>
            )}

            <ItemGroup>
                <Item
                    title={t('desktopUpdate.checkNow')}
                    icon={<Ionicons name="refresh-outline" size={29} color="#007AFF" />}
                    onPress={() => void prepare()}
                    loading={update.phase === 'checking'}
                    disabled={update.phase === 'downloading' || update.phase === 'downloaded' || update.phase === 'installing'}
                    showChevron={false}
                />
                {update.phase === 'available' && (
                    <Item
                        title={t('desktopUpdate.download')}
                        subtitle={t('desktopUpdate.downloadSubtitle')}
                        icon={<Ionicons name="cloud-download-outline" size={29} color="#34C759" />}
                        onPress={() => void prepare()}
                        showChevron={false}
                    />
                )}
                {(update.phase === 'downloaded' || update.phase === 'installError') && (
                    <Item
                        title={t('desktopUpdate.restartNow')}
                        subtitle={t('desktopUpdate.readyMessage')}
                        icon={<Ionicons name="reload-outline" size={29} color="#34C759" />}
                        onPress={() => void installDesktopUpdateAndRelaunch()}
                        showChevron={false}
                    />
                )}
            </ItemGroup>
        </ItemList>
    );
}
