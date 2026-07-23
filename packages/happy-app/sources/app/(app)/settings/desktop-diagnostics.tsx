import { Ionicons } from '@expo/vector-icons';
import { invoke } from '@tauri-apps/api/core';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { showCopiedToast } from '@/components/Toast';
import {
    formatDesktopDiagnostics,
    sanitizeDiagnosticUrl,
    type DesktopNativeDiagnostics,
} from '@/desktop/desktopDiagnostics';
import { Modal } from '@/modal';
import { getServerInfo } from '@/sync/serverConfig';
import { useSocketStatus } from '@/sync/storage';
import { t } from '@/text';

const CONNECTION_TIMEOUT_MS = 10_000;

type ConnectionCheck = 'idle' | 'checking' | 'reachable' | 'unreachable';

export default function DesktopDiagnosticsScreen() {
    const socket = useSocketStatus();
    const [native, setNative] = React.useState<DesktopNativeDiagnostics | null>(null);
    const [connectionCheck, setConnectionCheck] = React.useState<ConnectionCheck>('idle');
    const server = getServerInfo();

    React.useEffect(() => {
        void invoke<DesktopNativeDiagnostics>('get_desktop_diagnostics')
            .then(setNative)
            .catch((error) => {
                console.warn('Failed to load desktop diagnostics:', error);
            });
    }, []);

    const report = React.useMemo(() => native ? formatDesktopDiagnostics({
        native,
        server: {
            entryUrl: server.entryUrl,
            resolvedUrl: server.resolvedUrl,
            isCustom: server.isCustom,
        },
        socket,
        webviewUserAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    }) : null, [native, server.entryUrl, server.isCustom, server.resolvedUrl, socket]);

    const testConnection = React.useCallback(async () => {
        setConnectionCheck('checking');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
        try {
            const response = await fetch(`${server.resolvedUrl}/v1/app-config`, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
            setConnectionCheck(response.ok ? 'reachable' : 'unreachable');
        } catch {
            setConnectionCheck('unreachable');
        } finally {
            clearTimeout(timeout);
        }
    }, [server.resolvedUrl]);

    const connectionSubtitle = connectionCheck === 'checking'
        ? t('desktopDiagnostics.checking')
        : connectionCheck === 'reachable'
            ? t('desktopDiagnostics.reachable')
            : connectionCheck === 'unreachable'
                ? t('desktopDiagnostics.unreachable')
                : undefined;

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup title={t('desktopDiagnostics.overview')}>
                <Item
                    title={t('desktopDiagnostics.version')}
                    detail={native?.appVersion ?? '—'}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.platform')}
                    detail={native ? `${native.operatingSystem} · ${native.architecture}` : '—'}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.build')}
                    detail={native?.buildProfile ?? '—'}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.identifier')}
                    detail={native?.identifier ?? '—'}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('desktopDiagnostics.server')}>
                <Item
                    title={t('desktopDiagnostics.server')}
                    subtitle={sanitizeDiagnosticUrl(server.resolvedUrl)}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.serverType')}
                    detail={server.isCustom
                        ? t('desktopDiagnostics.customServer')
                        : t('desktopDiagnostics.defaultServer')}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.connection')}
                    detail={socket.status}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.lastConnected')}
                    detail={socket.lastConnectedAt
                        ? new Date(socket.lastConnectedAt).toLocaleString()
                        : t('desktopDiagnostics.never')}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup
                title={t('desktopDiagnostics.actions')}
                footer={t('desktopDiagnostics.privacyFooter')}
            >
                <Item
                    title={t('desktopDiagnostics.testConnection')}
                    subtitle={connectionSubtitle}
                    icon={<Ionicons name="pulse-outline" size={29} color="#34C759" />}
                    onPress={testConnection}
                    loading={connectionCheck === 'checking'}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.copy')}
                    icon={<Ionicons name="copy-outline" size={29} color="#007AFF" />}
                    disabled={!report}
                    onPress={async () => {
                        if (!report) return;
                        await Clipboard.setStringAsync(report);
                        showCopiedToast();
                    }}
                    showChevron={false}
                />
                <Item
                    title={t('desktopDiagnostics.openLogs')}
                    subtitle={native?.logDirectory}
                    icon={<Ionicons name="folder-open-outline" size={29} color="#AF52DE" />}
                    onPress={async () => {
                        try {
                            await invoke('open_desktop_log_directory');
                        } catch (error) {
                            console.warn('Failed to open desktop log directory:', error);
                            Modal.alert(t('errors.operationFailed'), t('errors.tryAgain'));
                        }
                    }}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
