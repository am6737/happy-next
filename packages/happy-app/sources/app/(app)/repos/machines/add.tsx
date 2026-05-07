import * as React from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { RoundButton } from '@/components/RoundButton';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { showToast } from '@/components/Toast';
import {
    addMockLabMachine,
    generateDockerCommand,
    type MockLabMachine,
} from '@/data/mockRepos';
import { t } from '@/text';

type RegisterMethod = 'qr' | 'docker' | 'manual' | 'server' | null;

const stylesheet = StyleSheet.create((theme) => ({
    section: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
    },
    methodCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
        marginBottom: 10,
    },
    methodCardActive: {
        borderColor: theme.colors.button.primary.background,
        borderWidth: 1.5,
    },
    methodHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    methodIconBox: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    methodTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    methodSubtitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    methodBody: {
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    commandBox: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    commandText: {
        flex: 1,
        fontSize: 12,
        fontFamily: 'Menlo',
        color: theme.colors.text,
    },
    copyButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.button.primary.background,
    },
    copyButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.button.primary.tint,
    },
    urlInput: {
        flex: 1,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('regular'),
    },
    urlInputError: {
        borderColor: '#FF3B30',
    },
    urlError: {
        fontSize: 12,
        color: '#FF3B30',
        marginTop: 4,
    },
    inputRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'flex-start',
    },
    qrContainer: {
        alignItems: 'center',
        gap: 12,
    },
    qrPlaceholder: {
        width: 160,
        height: 160,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderStyle: 'dashed',
    },
    qrText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 8,
        textAlign: 'center',
    },
    successCard: {
        backgroundColor: '#34C75920',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#34C75940',
        padding: 14,
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    successText: {
        fontSize: 14,
        color: '#34C759',
        fontWeight: '500',
    },
}));

function validateUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export default function AddMachineScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();

    const [method, setMethod] = React.useState<RegisterMethod>(null);
    const [manualUrl, setManualUrl] = React.useState('');
    const [urlError, setUrlError] = React.useState('');
    const [isConnecting, setIsConnecting] = React.useState(false);
    const [isRegistered, setIsRegistered] = React.useState(false);
    const [newMachineId, setNewMachineId] = React.useState('');

    const dockerCommand = React.useMemo(() => generateDockerCommand(`pending-${Date.now()}`), []);

    const handleCopyCommand = React.useCallback(() => {
        // On web, we'd use Clipboard API. On native, show a toast.
        showToast(t('lab.machineCopied'));
    }, []);

    const handleManualConnect = React.useCallback(() => {
        if (!manualUrl.trim()) return;
        if (!validateUrl(manualUrl.trim())) {
            setUrlError(t('lab.machineManualUrlInvalid'));
            return;
        }
        setUrlError('');
        setIsConnecting(true);
        const machineId = `lab-mach-${Date.now()}`;
        setNewMachineId(machineId);

        // Simulate connection (3s)
        setTimeout(() => {
            setIsConnecting(false);
            setIsRegistered(true);
            addMockLabMachine({
                id: machineId,
                type: 'cloud',
                name: new URL(manualUrl.trim()).hostname,
                host: manualUrl.trim(),
                status: 'creating',
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                creatingProgress: 0,
                registeredVia: 'manual',
            });
        }, 3000);
    }, [manualUrl]);

    const handleQrSimulate = React.useCallback(() => {
        const machineId = `lab-mach-${Date.now()}`;
        setNewMachineId(machineId);
        setIsConnecting(true);

        // Simulate QR pairing (10s)
        setTimeout(() => {
            setIsConnecting(false);
            setIsRegistered(true);
            addMockLabMachine({
                id: machineId,
                type: 'local',
                name: 'Scanned Machine',
                host: 'local-agent',
                status: 'creating',
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                creatingProgress: 0,
                registeredVia: 'qr',
            });
        }, 10000);
    }, []);

    const handleDockerSimulate = React.useCallback(() => {
        const machineId = `lab-mach-${Date.now()}`;
        setNewMachineId(machineId);
        setIsConnecting(true);

        // Simulate docker registration (5s)
        setTimeout(() => {
            setIsConnecting(false);
            setIsRegistered(true);
            addMockLabMachine({
                id: machineId,
                type: 'cloud',
                name: 'Docker Agent',
                host: 'localhost:3000',
                status: 'creating',
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                creatingProgress: 0,
                registeredVia: 'docker',
            });
        }, 5000);
    }, []);

    const handleServerSimulate = React.useCallback(() => {
        const machineId = `lab-mach-${Date.now()}`;
        setNewMachineId(machineId);
        setIsConnecting(true);

        // Simulate server cloud machine creation (8s)
        setTimeout(() => {
            setIsConnecting(false);
            setIsRegistered(true);
            addMockLabMachine({
                id: machineId,
                type: 'cloud',
                name: 'Server Cloud',
                host: 'cloud.server-managed',
                status: 'creating',
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                creatingProgress: 0,
                registeredVia: 'server',
            });
        }, 8000);
    }, []);

    const renderQrContent = () => (
        <View style={styles.qrContainer}>
            <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={48} color={theme.colors.textSecondary} />
            </View>
            <Text style={styles.qrText}>
                Run `happy agent --register` on your machine{'\n'}then scan the QR code shown in the terminal
            </Text>
            {isConnecting ? (
                <>
                    <ActivityIndicator size="small" color="#007AFF" style={{ marginTop: 12 }} />
                    <Text style={{ fontSize: 12, color: '#007AFF', marginTop: 6 }}>Waiting for scan…</Text>
                </>
            ) : (
                <RoundButton
                    title="Simulate Scan"
                    size="normal"
                    onPress={handleQrSimulate}
                    style={{ marginTop: 12 }}
                />
            )}
        </View>
    );

    const renderDockerContent = () => (
        <View style={styles.methodBody}>
            <Text style={[styles.methodSubtitle, { marginTop: 0 }]}>
                Copy and run this command on your machine:
            </Text>
            <View style={styles.commandBox}>
                <Text style={styles.commandText} numberOfLines={1}>{dockerCommand}</Text>
                <Pressable style={styles.copyButton} onPress={handleCopyCommand}>
                    <Text style={styles.copyButtonText}>Copy</Text>
                </Pressable>
            </View>
            {isConnecting ? (
                <>
                    <ActivityIndicator size="small" color="#007AFF" style={{ marginTop: 12 }} />
                    <Text style={{ fontSize: 12, color: '#007AFF', marginTop: 6 }}>Waiting for agent to connect…</Text>
                </>
            ) : (
                <RoundButton
                    title="Simulate Connection"
                    size="normal"
                    onPress={handleDockerSimulate}
                    style={{ marginTop: 12 }}
                />
            )}
        </View>
    );

    const renderManualContent = () => (
        <View style={styles.methodBody}>
            <View style={styles.inputRow}>
                <TextInput
                    style={[styles.urlInput, urlError ? styles.urlInputError : undefined]}
                    placeholder={t('lab.machineManualPlaceholder')}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={manualUrl}
                    onChangeText={(text) => { setManualUrl(text); setUrlError(''); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    editable={!isConnecting && !isRegistered}
                />
                <RoundButton
                    title={t('lab.machineManualConnect')}
                    size="normal"
                    onPress={handleManualConnect}
                    loading={isConnecting}
                    disabled={!manualUrl.trim() || isRegistered}
                />
            </View>
            {urlError ? <Text style={styles.urlError}>{urlError}</Text> : null}
        </View>
    );

    const renderServerContent = () => (
        <View style={styles.methodBody}>
            {isConnecting ? (
                <>
                    <ActivityIndicator size="small" color="#5856D6" style={{ marginTop: 12 }} />
                    <Text style={{ fontSize: 12, color: '#5856D6', marginTop: 6 }}>Creating cloud machine...</Text>
                </>
            ) : (
                <RoundButton
                    title="Create Server Machine"
                    size="normal"
                    onPress={handleServerSimulate}
                    style={{ marginTop: 12 }}
                />
            )}
        </View>
    );

    return (
        <ScrollView style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
            <Stack.Screen options={{ title: t('lab.machineRegisterTitle') }} />

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('lab.machineRegisterQr')}</Text>

                {/* QR Code Method */}
                <View style={[styles.methodCard, method === 'qr' && styles.methodCardActive]}>
                    <Pressable style={styles.methodHeader} onPress={() => setMethod(method === 'qr' ? null : 'qr')}>
                        <View style={[styles.methodIconBox, { backgroundColor: '#007AFF15' }]}>
                            <Ionicons name="qr-code-outline" size={22} color="#007AFF" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.methodTitle}>{t('lab.machineQrTitle')}</Text>
                            <Text style={styles.methodSubtitle}>{t('lab.machineQrSubtitle')}</Text>
                        </View>
                        <Ionicons
                            name={method === 'qr' ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    {method === 'qr' && renderQrContent()}
                </View>

                {/* Docker Method */}
                <View style={[styles.methodCard, method === 'docker' && styles.methodCardActive]}>
                    <Pressable style={styles.methodHeader} onPress={() => setMethod(method === 'docker' ? null : 'docker')}>
                        <View style={[styles.methodIconBox, { backgroundColor: '#2496ED15' }]}>
                            <Ionicons name="logo-docker" size={22} color="#2496ED" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.methodTitle}>{t('lab.machineDockerTitle')}</Text>
                            <Text style={styles.methodSubtitle}>{t('lab.machineDockerSubtitle')}</Text>
                        </View>
                        <Ionicons
                            name={method === 'docker' ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    {method === 'docker' && renderDockerContent()}
                </View>

                {/* Manual URL Method */}
                <View style={[styles.methodCard, method === 'manual' && styles.methodCardActive]}>
                    <Pressable style={styles.methodHeader} onPress={() => setMethod(method === 'manual' ? null : 'manual')}>
                        <View style={[styles.methodIconBox, { backgroundColor: '#5AC8FA15' }]}>
                            <Ionicons name="link-outline" size={22} color="#5AC8FA" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.methodTitle}>{t('lab.machineManualTitle')}</Text>
                            <Text style={styles.methodSubtitle}>{t('lab.machineManualSubtitle')}</Text>
                        </View>
                        <Ionicons
                            name={method === 'manual' ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    {method === 'manual' && renderManualContent()}
                </View>

                {/* Server Cloud Method */}
                <View style={[styles.methodCard, method === 'server' && styles.methodCardActive]}>
                    <Pressable style={styles.methodHeader} onPress={() => setMethod(method === 'server' ? null : 'server')}>
                        <View style={[styles.methodIconBox, { backgroundColor: '#5856D615' }]}>
                            <Ionicons name="cloud-outline" size={22} color="#5856D6" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.methodTitle}>{t('lab.machineServerTitle')}</Text>
                            <Text style={styles.methodSubtitle}>{t('lab.machineServerSubtitle')}</Text>
                        </View>
                        <Ionicons
                            name={method === 'server' ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    {method === 'server' && renderServerContent()}
                </View>

                {isRegistered && (
                    <View style={styles.successCard}>
                        <Ionicons name="checkmark-circle" size={22} color="#34C759" />
                        <Text style={styles.successText}>
                            {method === 'qr' ? 'Machine paired successfully!' :
                             method === 'docker' ? 'Docker agent connected!' :
                             method === 'server' ? 'Server cloud machine created!' :
                             'Machine connected successfully!'}
                        </Text>
                    </View>
                )}
            </View>

            {isRegistered && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 32 }}>
                    <RoundButton
                        title="View Machine"
                        size="normal"
                        onPress={() => {
                            router.back();
                            setTimeout(() => router.push(`/repos/machine/${newMachineId}`), 100);
                        }}
                    />
                </View>
            )}
        </ScrollView>
    );
}
