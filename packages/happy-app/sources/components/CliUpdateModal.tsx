import * as React from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useMachine } from '@/sync/storage';
import { machineCliUpdatePreflight, machineUpdateCli, type CliUpdatePreflight } from '@/sync/ops';
import { useHappyAction } from '@/hooks/useHappyAction';
import { showCopiedToast, showToast } from '@/components/Toast';
import { getMachineCliUpdate, watchCliInstall } from '@/utils/cliUpdate';
import { compareVersions } from '@/utils/versionUtils';

const CHANGELOG_URL = 'https://github.com/hitosea/happy-next/commits/main/packages/happy-cli';
const FALLBACK_MANUAL_COMMAND = 'happy update';

// Machines whose update dialog is open: it shows the outcome itself, so no toast then
const openDialogs = new Set<string>();

/**
 * The CLI update dialog for a machine: what an update interrupts (from the daemon's preflight),
 * then the install's progress and outcome. It can be closed at any point; an install started
 * here then ends in a toast.
 */
export function showCliUpdateModal(machineId: string) {
    Modal.show({ component: CliUpdateModalContent, props: { machineId } });
}

function CliUpdateModalContent({ machineId, onClose }: { machineId: string; onClose: () => void }) {
    const { theme } = useUnistyles();
    const machine = useMachine(machineId);
    const update = getMachineCliUpdate(machine);
    const running = machine?.metadata?.happyCliVersion ?? '';
    // undefined while loading; null for daemons before 0.13 (or when it could not be loaded)
    const [preflight, setPreflight] = React.useState<CliUpdatePreflight | null | undefined>(undefined);
    const [startedVersion, setStartedVersion] = React.useState<string | null>(null);
    const [unsupportedReason, setUnsupportedReason] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);

    React.useEffect(() => {
        openDialogs.add(machineId);
        return () => {
            openDialogs.delete(machineId);
        };
    }, [machineId]);

    React.useEffect(() => {
        let cancelled = false;
        machineCliUpdatePreflight(machineId)
            .then((result) => !cancelled && setPreflight(result))
            .catch(() => !cancelled && setPreflight(null));
        return () => {
            cancelled = true;
        };
    }, [machineId]);

    const targetVersion = startedVersion ?? (update.state === 'none' ? null : update.version);

    const [starting, startUpdate] = useHappyAction(React.useCallback(async () => {
        setNotice(null);
        const result = await machineUpdateCli(machineId);
        switch (result.status) {
            case 'started': {
                const version = result.latestVersion ?? targetVersion ?? '';
                setStartedVersion(version);
                watchCliInstall(machineId, version, (outcome) => {
                    if (openDialogs.has(machineId)) return;
                    if (outcome === 'installed') {
                        showToast(t('cliUpdate.success', { version }));
                    } else {
                        showToast(t('cliUpdate.failedToast', { version }), { icon: 'alert-circle' });
                    }
                });
                break;
            }
            case 'up-to-date':
                showToast(t('cliUpdate.upToDate'));
                onClose();
                break;
            case 'busy':
                setNotice(t('cliUpdate.busy'));
                break;
            case 'unsupported':
                setUnsupportedReason(result.reason ?? 'no-permission');
                break;
            default:
                setNotice(t('cliUpdate.checkFailed'));
        }
    }, [machineId, targetVersion, onClose]));

    const installed = !!startedVersion && !!running && compareVersions(running, startedVersion) >= 0;
    const view = installed ? 'success' : update.state;
    const preflightUnsupported = preflight && !preflight.support.supported ? preflight.support.reason : null;
    const unsupported = unsupportedReason ?? preflightUnsupported;
    const manualCommand = preflight?.manualCommand ?? FALLBACK_MANUAL_COMMAND;
    const activity = preflight?.activity;

    const commandBox = (
        <Pressable
            style={({ pressed }) => [styles.commandBox, pressed && styles.pressed]}
            onPress={async () => {
                await Clipboard.setStringAsync(manualCommand);
                showCopiedToast();
            }}
        >
            <Text style={styles.commandText} selectable>{manualCommand}</Text>
            <Ionicons name="copy-outline" size={16} color={theme.colors.textSecondary} />
        </Pressable>
    );

    let body: React.ReactNode;
    let canUpdate = false;
    let primaryLabel: string | null = null;
    switch (view) {
        case 'success':
            body = (
                <View style={styles.statusRow}>
                    <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
                    <Text style={styles.statusText}>{t('cliUpdate.success', { version: startedVersion ?? running })}</Text>
                </View>
            );
            break;
        case 'installing':
            body = (
                <>
                    <View style={styles.statusRow}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={styles.statusText}>{t('cliUpdate.installingMessage', { version: update.state === 'installing' ? update.version : targetVersion ?? '' })}</Text>
                    </View>
                    {machine && !machine.active && (
                        <Text style={styles.hint}>{t('cliUpdate.offlineHint')}</Text>
                    )}
                </>
            );
            break;
        case 'failed':
            body = (
                <>
                    <Text style={styles.message}>{t('cliUpdate.failedMessage', { version: update.state === 'failed' ? update.version : '' })}</Text>
                    {update.state === 'failed' && !!update.error && (
                        <ScrollView style={styles.errorBox} contentContainerStyle={styles.errorContent} nestedScrollEnabled>
                            <Text style={styles.errorText} selectable>{update.error}</Text>
                        </ScrollView>
                    )}
                    <Text style={styles.message}>{t('cliUpdate.manualCommand')}</Text>
                    {commandBox}
                </>
            );
            canUpdate = true;
            primaryLabel = t('common.retry');
            break;
        case 'available':
            if (unsupported) {
                body = (
                    <>
                        <Text style={styles.message}>{unsupported === 'no-permission' ? t('cliUpdate.noPermission') : t('cliUpdate.notGlobal')}</Text>
                        {commandBox}
                    </>
                );
                break;
            }
            body = preflight === undefined ? (
                <ActivityIndicator style={styles.loading} size="small" color={theme.colors.textSecondary} />
            ) : (
                <View style={styles.impacts}>
                    {!!activity?.executions && (
                        <View style={styles.impactRow}>
                            <Ionicons name="alert-circle" size={18} color={theme.colors.textDestructive} />
                            <Text style={[styles.impactText, styles.impactEmphasis]}>{t('cliUpdate.impactExecutions', { count: activity.executions })}</Text>
                        </View>
                    )}
                    {!!activity?.terminals && (
                        <View style={styles.impactRow}>
                            <Ionicons name="terminal-outline" size={18} color={theme.colors.textSecondary} />
                            <Text style={styles.impactText}>{t('cliUpdate.impactTerminals', { count: activity.terminals })}</Text>
                        </View>
                    )}
                    {!!activity?.sessions && (
                        <View style={styles.impactRow}>
                            <Ionicons name="chatbubbles-outline" size={18} color={theme.colors.textSecondary} />
                            <Text style={styles.impactText}>{t('cliUpdate.impactSessions', { count: activity.sessions })}</Text>
                        </View>
                    )}
                </View>
            );
            canUpdate = preflight !== undefined;
            primaryLabel = t('cliUpdate.update');
            break;
        default:
            body = <Text style={styles.message}>{t('cliUpdate.upToDate')}</Text>;
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('cliUpdate.title')}</Text>
            <Text style={styles.versions}>
                {targetVersion && view !== 'none' ? `v${running} → v${targetVersion}` : `v${running}`}
            </Text>
            {view === 'available' && !unsupported && (
                <Pressable onPress={() => WebBrowser.openBrowserAsync(CHANGELOG_URL)} hitSlop={8}>
                    <Text style={styles.link}>{t('cliUpdate.changelog')}</Text>
                </Pressable>
            )}
            <View style={styles.body}>{body}</View>
            {!!notice && <Text style={styles.notice}>{notice}</Text>}
            <View style={styles.buttons}>
                <Pressable
                    style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.pressed]}
                    onPress={onClose}
                >
                    <Text style={styles.buttonSecondaryText}>
                        {primaryLabel ? t('common.cancel') : t('common.ok')}
                    </Text>
                </Pressable>
                {primaryLabel && (
                    <Pressable
                        style={({ pressed }) => [styles.button, styles.buttonPrimary, (pressed || !canUpdate) && styles.pressed]}
                        onPress={startUpdate}
                        disabled={!canUpdate || starting}
                    >
                        {starting ? (
                            <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                        ) : (
                            <Text style={styles.buttonPrimaryText}>{primaryLabel}</Text>
                        )}
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        width: 340,
        maxWidth: '100%',
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: theme.colors.modal.border,
        backgroundColor: theme.colors.surface,
    },
    title: {
        fontSize: 17,
        textAlign: 'center',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    versions: {
        fontSize: 14,
        textAlign: 'center',
        marginTop: 6,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    link: {
        fontSize: 14,
        textAlign: 'center',
        marginTop: 6,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
    body: {
        marginTop: 16,
        gap: 10,
    },
    loading: {
        paddingVertical: 8,
    },
    impacts: {
        gap: 10,
    },
    impactRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    impactText: {
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default(),
    },
    impactEmphasis: {
        color: theme.colors.textDestructive,
        ...Typography.default('semiBold'),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    statusText: {
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default(),
    },
    message: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default(),
    },
    hint: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    // The whole error, scrolling past a few lines
    errorBox: {
        maxHeight: 200,
        flexGrow: 0,
        borderRadius: 10,
        backgroundColor: theme.colors.box.error.background,
    },
    errorContent: {
        padding: 10,
    },
    errorText: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.box.error.text,
        ...Typography.mono(),
    },
    commandBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surfaceHigh,
    },
    commandText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.mono(),
    },
    notice: {
        marginTop: 12,
        fontSize: 13,
        color: theme.colors.textDestructive,
        ...Typography.default(),
    },
    buttons: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 20,
    },
    button: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonSecondary: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    buttonSecondaryText: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    buttonPrimary: {
        backgroundColor: theme.colors.button.primary.background,
    },
    buttonPrimaryText: {
        fontSize: 15,
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
    pressed: {
        opacity: 0.7,
    },
}));
