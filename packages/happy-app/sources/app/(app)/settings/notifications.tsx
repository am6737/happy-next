import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { useLocalSettingMutable } from '@/sync/storage';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/tauri';

export default function NotificationSettingsScreen() {
    const [hideNotificationsWhenActive, setHideNotificationsWhenActive] = useLocalSettingMutable('hideNotificationsWhenActive');
    const [hideSessionNotificationsWhenActive, setHideSessionNotificationsWhenActive] = useLocalSettingMutable('hideSessionNotificationsWhenActive');
    const [desktopCloseToTray, setDesktopCloseToTray] = useLocalSettingMutable('desktopCloseToTray');
    const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useLocalSettingMutable('desktopNotificationsEnabled');
    const [desktopAutostartEnabled, setDesktopAutostartEnabled] = useLocalSettingMutable('desktopAutostartEnabled');
    const [desktopGlobalShortcutEnabled, setDesktopGlobalShortcutEnabled] = useLocalSettingMutable('desktopGlobalShortcutEnabled');
    const disableSessionToggle = hideNotificationsWhenActive;

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {isTauriDesktop() && (
                <ItemGroup
                    title={t('settingsDesktop.title')}
                    footer={t('settingsDesktop.footer')}
                >
                    <Item
                        title={t('settingsDesktop.nativeNotificationsTitle')}
                        subtitle={t('settingsDesktop.nativeNotificationsSubtitle')}
                        icon={<Ionicons name="notifications-outline" size={29} color="#FF2D55" />}
                        rightElement={<Switch value={desktopNotificationsEnabled} onValueChange={setDesktopNotificationsEnabled} />}
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsDesktop.closeToTrayTitle')}
                        subtitle={t('settingsDesktop.closeToTraySubtitle')}
                        icon={<Ionicons name="albums-outline" size={29} color="#007AFF" />}
                        rightElement={<Switch value={desktopCloseToTray} onValueChange={setDesktopCloseToTray} />}
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsDesktop.autostartTitle')}
                        subtitle={t('settingsDesktop.autostartSubtitle')}
                        icon={<Ionicons name="power-outline" size={29} color="#34C759" />}
                        rightElement={<Switch value={desktopAutostartEnabled} onValueChange={setDesktopAutostartEnabled} />}
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsDesktop.shortcutTitle')}
                        subtitle={t('settingsDesktop.shortcutSubtitle')}
                        icon={<Ionicons name="keypad-outline" size={29} color="#AF52DE" />}
                        rightElement={<Switch value={desktopGlobalShortcutEnabled} onValueChange={setDesktopGlobalShortcutEnabled} />}
                        showChevron={false}
                    />
                </ItemGroup>
            )}
            <ItemGroup
                title={t('settingsNotifications.title')}
                footer={t('settingsNotifications.footer')}
            >
                <Item
                    title={t('settingsNotifications.hideAllTitle')}
                    subtitle={t('settingsNotifications.hideAllSubtitle')}
                    icon={<Ionicons name="notifications-off-outline" size={29} color="#FF3B30" />}
                    rightElement={(
                        <Switch
                            value={hideNotificationsWhenActive}
                            onValueChange={setHideNotificationsWhenActive}
                        />
                    )}
                    showChevron={false}
                />
                <Item
                    title={t('settingsNotifications.hideSessionTitle')}
                    subtitle={t('settingsNotifications.hideSessionSubtitle')}
                    icon={<Ionicons name="chatbubble-ellipses-outline" size={29} color="#007AFF" />}
                    rightElement={(
                        <Switch
                            value={hideSessionNotificationsWhenActive}
                            onValueChange={setHideSessionNotificationsWhenActive}
                            disabled={disableSessionToggle}
                        />
                    )}
                    disabled={disableSessionToggle}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
