import * as React from 'react';
import { View, Pressable, TextInput, ScrollView } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import { RoundButton } from '@/components/RoundButton';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import type { Machine } from '@/sync/storageTypes';
import {
    addMockLabMachine,
    generateDockerCommand,
} from '@/data/mockRepos';

type AddMethod = 'qr' | 'docker' | 'manual' | 'server' | null;

interface MachinePickerSheetProps {
    onSelect: (machineId: string) => void;
    onCancel?: () => void;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    pageContainer: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        textAlign: 'center',
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 8,
    },
    backButtonText: {
        fontSize: 15,
        color: '#007AFF',
    },
    // Machine list
    machineList: {
        flex: 1,
    },
    machineItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    machineItemText: {
        fontSize: 15,
        fontWeight: '600',
    },
    machineItemSubtext: {
        fontSize: 12,
        marginTop: 2,
    },
    empty: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    // Add machine section at bottom of list
    addSection: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginTop: 8,
    },
    addSectionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    addSectionButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#007AFF',
    },
    // Add machine form page
    formContainer: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    formContent: {
        padding: 16,
        gap: 16,
    },
    methodCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 14,
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
    successCard: {
        backgroundColor: '#34C75920',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#34C75940',
        padding: 14,
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

export const MachinePickerSheet = React.memo(React.forwardRef<BottomSheetModal, MachinePickerSheetProps>(
    ({ onSelect, onCancel }, ref) => {
        const { theme } = useUnistyles();

        // Get all machines from storage (reactive)
        const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;

        // Filter for online machines only
        const onlineMachines = React.useMemo(() => {
            return Object.values(machines).filter(m => isMachineOnline(m));
        }, [machines]);

        // Page state: 0 = machine list, 1 = add machine form
        const [currentPage, setCurrentPage] = React.useState(0);

        // Add machine form state
        const [addMethod, setAddMethod] = React.useState<AddMethod>(null);
        const [manualUrl, setManualUrl] = React.useState('');
        const [urlError, setUrlError] = React.useState('');
        const [isConnecting, setIsConnecting] = React.useState(false);
        const [isRegistered, setIsRegistered] = React.useState(false);

        const dockerCommand = React.useMemo(() => generateDockerCommand(`pending-${Date.now()}`), []);

        const goToPage = React.useCallback((page: number) => {
            // Instant page switch - no animation
            setCurrentPage(page);
        }, []);

        const handleDismiss = React.useCallback(() => {
            setCurrentPage(0);
            setAddMethod(null);
            setManualUrl('');
            setUrlError('');
            setIsConnecting(false);
            setIsRegistered(false);
            onCancel?.();
        }, [onCancel]);

        const renderBackdrop = React.useCallback(
            (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
            [],
        );

        // ---- Page 0: Machine List ----
        const renderMachineListPage = () => (
            <View style={[styles.pageContainer, { backgroundColor: theme.colors.surface }]}>
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        {t('repoSettings.selectMachine')}
                    </Text>
                </View>

                <ScrollView style={styles.machineList} contentContainerStyle={{ flexGrow: 1 }}>
                    {onlineMachines.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyText}>{t('repoSettings.noMachineAvailable')}</Text>
                        </View>
                    ) : (
                        onlineMachines.map((machine) => (
                            <Pressable
                                key={machine.id}
                                style={[styles.machineItem, { borderBottomColor: theme.colors.divider }]}
                                onPress={() => onSelect(machine.id)}
                            >
                                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#34C759' }} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={[styles.machineItemText, { color: theme.colors.text }]}>
                                        {machine.metadata?.displayName || machine.metadata?.host || machine.id}
                                    </Text>
                                    {machine.metadata?.homeDir && (
                                        <Text style={[styles.machineItemSubtext, { color: theme.colors.textSecondary }]}>
                                            {machine.metadata.homeDir}
                                        </Text>
                                    )}
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                            </Pressable>
                        ))
                    )}

                    {/* Add New Machine Button */}
                    <View style={styles.addSection}>
                        <Pressable
                            style={styles.addSectionButton}
                            onPress={() => goToPage(1)}
                        >
                            <Ionicons name="add-circle" size={22} color="#007AFF" />
                            <Text style={styles.addSectionButtonText}>Add New Machine</Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </View>
        );

        // ---- Page 1: Add Machine Form ----
        const handleCopyCommand = () => {
            showToast(t('lab.machineCopied'));
        };

        const handleManualConnect = () => {
            if (!manualUrl.trim()) return;
            if (!validateUrl(manualUrl.trim())) {
                setUrlError(t('lab.machineManualUrlInvalid'));
                return;
            }
            setUrlError('');
            setIsConnecting(true);
            const machineId = `lab-mach-${Date.now()}`;

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
        };

        const handleQrSimulate = () => {
            const machineId = `lab-mach-${Date.now()}`;
            setIsConnecting(true);

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
        };

        const handleDockerSimulate = () => {
            const machineId = `lab-mach-${Date.now()}`;
            setIsConnecting(true);

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
        };

        const handleServerSimulate = () => {
            const machineId = `lab-mach-${Date.now()}`;
            setIsConnecting(true);

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
        };

        const renderAddMachinePage = () => (
            <View style={[styles.pageContainer, { backgroundColor: theme.colors.surface }]}>
                <View style={styles.header}>
                    <Pressable style={styles.backButton} onPress={() => goToPage(0)}>
                        <Ionicons name="chevron-back" size={20} color="#007AFF" />
                        <Text style={styles.backButtonText}>Back</Text>
                    </Pressable>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        {t('lab.machineRegisterTitle')}
                    </Text>
                    <View style={{ height: 40 }} />
                </View>

                <ScrollView style={styles.formContainer} contentContainerStyle={styles.formContent}>
                    {/* QR Code Method */}
                    <View style={[styles.methodCard, addMethod === 'qr' && styles.methodCardActive]}>
                        <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'qr' ? null : 'qr')}>
                            <View style={[styles.methodIconBox, { backgroundColor: '#007AFF15' }]}>
                                <Ionicons name="qr-code-outline" size={22} color="#007AFF" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.methodTitle}>{t('lab.machineQrTitle')}</Text>
                                <Text style={styles.methodSubtitle}>{t('lab.machineQrSubtitle')}</Text>
                            </View>
                            <Ionicons name={addMethod === 'qr' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                        {addMethod === 'qr' && (
                            <View style={styles.methodBody}>
                                <Text style={styles.methodSubtitle}>Scan QR code to pair your machine</Text>
                                {isConnecting ? (
                                    <Text style={{ marginTop: 12, color: '#007AFF' }}>Waiting for scan…</Text>
                                ) : (
                                    <RoundButton title="Simulate Scan" size="normal" onPress={handleQrSimulate} style={{ marginTop: 12 }} />
                                )}
                            </View>
                        )}
                    </View>

                    {/* Docker Method */}
                    <View style={[styles.methodCard, addMethod === 'docker' && styles.methodCardActive]}>
                        <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'docker' ? null : 'docker')}>
                            <View style={[styles.methodIconBox, { backgroundColor: '#2496ED15' }]}>
                                <Ionicons name="logo-docker" size={22} color="#2496ED" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.methodTitle}>{t('lab.machineDockerTitle')}</Text>
                                <Text style={styles.methodSubtitle}>{t('lab.machineDockerSubtitle')}</Text>
                            </View>
                            <Ionicons name={addMethod === 'docker' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                        {addMethod === 'docker' && (
                            <View style={styles.methodBody}>
                                <View style={styles.commandBox}>
                                    <Text style={styles.commandText} numberOfLines={1}>{dockerCommand}</Text>
                                    <Pressable style={styles.copyButton} onPress={handleCopyCommand}>
                                        <Text style={styles.copyButtonText}>Copy</Text>
                                    </Pressable>
                                </View>
                                {isConnecting ? (
                                    <Text style={{ marginTop: 12, color: '#007AFF' }}>Waiting for agent to connect…</Text>
                                ) : (
                                    <RoundButton title="Simulate Connection" size="normal" onPress={handleDockerSimulate} style={{ marginTop: 12 }} />
                                )}
                            </View>
                        )}
                    </View>

                    {/* Manual URL Method */}
                    <View style={[styles.methodCard, addMethod === 'manual' && styles.methodCardActive]}>
                        <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'manual' ? null : 'manual')}>
                            <View style={[styles.methodIconBox, { backgroundColor: '#5AC8FA15' }]}>
                                <Ionicons name="link-outline" size={22} color="#5AC8FA" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.methodTitle}>{t('lab.machineManualTitle')}</Text>
                                <Text style={styles.methodSubtitle}>{t('lab.machineManualSubtitle')}</Text>
                            </View>
                            <Ionicons name={addMethod === 'manual' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                        {addMethod === 'manual' && (
                            <View style={styles.methodBody}>
                                <TextInput
                                    style={{ backgroundColor: theme.colors.surfaceHighest, borderRadius: 8, borderWidth: 1, borderColor: urlError ? '#FF3B30' : theme.colors.divider, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text }}
                                    placeholder={t('lab.machineManualPlaceholder')}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={manualUrl}
                                    onChangeText={(text) => { setManualUrl(text); setUrlError(''); }}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="url"
                                    editable={!isConnecting}
                                />
                                {urlError ? <Text style={{ fontSize: 12, color: '#FF3B30', marginTop: 4 }}>{urlError}</Text> : null}
                                <RoundButton title={t('lab.machineManualConnect')} size="normal" onPress={handleManualConnect} loading={isConnecting} disabled={!manualUrl.trim()} style={{ marginTop: 12 }} />
                            </View>
                        )}
                    </View>

                    {/* Server Cloud Method */}
                    <View style={[styles.methodCard, addMethod === 'server' && styles.methodCardActive]}>
                        <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'server' ? null : 'server')}>
                            <View style={[styles.methodIconBox, { backgroundColor: '#5856D615' }]}>
                                <Ionicons name="cloud-outline" size={22} color="#5856D6" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.methodTitle}>{t('lab.machineServerTitle')}</Text>
                                <Text style={styles.methodSubtitle}>{t('lab.machineServerSubtitle')}</Text>
                            </View>
                            <Ionicons name={addMethod === 'server' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                        {addMethod === 'server' && (
                            <View style={styles.methodBody}>
                                {isConnecting ? (
                                    <Text style={{ color: '#5856D6' }}>Creating cloud machine...</Text>
                                ) : (
                                    <RoundButton title="Create Server Machine" size="normal" onPress={handleServerSimulate} style={{ marginTop: 12 }} />
                                )}
                            </View>
                        )}
                    </View>

                    {isRegistered && (
                        <View style={styles.successCard}>
                            <Ionicons name="checkmark-circle" size={22} color="#34C759" />
                            <Text style={styles.successText}>Machine added! Go back to select it.</Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        );

        return (
            <BottomSheetModal
                ref={ref}
                snapPoints={['85%']}
                enableDynamicSizing={false}
                backdropComponent={renderBackdrop}
                onDismiss={handleDismiss}
                backgroundStyle={{ backgroundColor: theme.colors.surface }}
                handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
            >
                <View style={styles.container}>
                    <View style={{ flex: 1 }}>
                        {currentPage === 0 ? renderMachineListPage() : renderAddMachinePage()}
                    </View>
                </View>
            </BottomSheetModal>
        );
    }
));
