import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text as StyledText } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { MOCK_GITHUB_REPOS_TO_ADD, type RepoInfo, setPendingCreatingRepo, addMockLabMachine, generateDockerCommand } from '@/data/mockRepos';
import { RoundButton } from '@/components/RoundButton';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';

interface SyncReposSheetProps {
    onClose: () => void;
}

type BindingState = 'selectingRepos' | 'selectingMachine' | 'selectingFolders' | 'idle';
type AddMethod = 'qr' | 'docker' | 'manual' | 'server' | null;

interface RepoWithBinding {
    repo: RepoInfo;
    path?: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Shell: '#89e051',
    MDX: '#fcb32c',
};

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
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
    selectAll: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    selectAllText: {
        flex: 1,
        fontSize: 15,
        ...Typography.default('regular'),
    },
    selectCount: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    listContent: {
        paddingVertical: 8,
    },
    repoItem: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 12,
    },
    repoItemLeft: {
        paddingTop: 2,
    },
    repoItemContent: {
        flex: 1,
        gap: 3,
    },
    repoItemHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    repoName: {
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
    },
    privateBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: 1,
    },
    privateBadgeText: {
        fontSize: 10,
    },
    repoDesc: {
        fontSize: 13,
        lineHeight: 18,
    },
    repoMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 2,
    },
    langDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    langText: {
        fontSize: 12,
    },
    empty: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    footer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    addButton: {
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    addButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    footerBack: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    footerBackText: {
        fontSize: 15,
        color: '#007AFF',
    },
    // Machine list page
    machineListContainer: {
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
    addMachineSection: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginTop: 8,
    },
    addMachineButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    addMachineButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#007AFF',
    },
    // Add machine form
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
    // Folder path page
    folderPathContainer: {
        flex: 1,
        padding: 16,
    },
    folderPathTitle: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 8,
    },
    folderPathInput: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        fontFamily: 'Menlo',
        color: theme.colors.text,
    },
    folderPathHint: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 8,
    },
    folderPathFooter: {
        flexDirection: 'row',
        gap: 12,
        paddingTop: 16,
    },
    folderPathButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    folderPathButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    folderProgress: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 16,
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

const RepoItem = React.memo(({ repo, isSelected, onToggle }: { repo: RepoInfo; isSelected: boolean; onToggle: () => void }) => {
    const { theme } = useUnistyles();
    const langColor = LANGUAGE_COLORS[repo.language] ?? theme.colors.textSecondary;

    return (
        <Pressable onPress={onToggle} style={[styles.repoItem, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
            <View style={styles.repoItemLeft}>
                <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={22} color={isSelected ? '#007AFF' : theme.colors.textSecondary} />
            </View>
            <View style={styles.repoItemContent}>
                <View style={styles.repoItemHeader}>
                    <Text style={[styles.repoName, { color: theme.colors.text }]} numberOfLines={1}>{repo.fullName}</Text>
                    {repo.isPrivate && (
                        <View style={[styles.privateBadge, { borderColor: theme.colors.divider }]}>
                            <Text style={[styles.privateBadgeText, { color: theme.colors.textSecondary }]}>Private</Text>
                        </View>
                    )}
                </View>
                <Text style={[styles.repoDesc, { color: theme.colors.textSecondary }]} numberOfLines={1}>{repo.description}</Text>
                <View style={styles.repoMeta}>
                    <View style={[styles.langDot, { backgroundColor: langColor }]} />
                    <Text style={[styles.langText, { color: theme.colors.textSecondary }]}>{repo.language}</Text>
                    <Ionicons name="star-outline" size={12} color={theme.colors.textSecondary} />
                    <Text style={[styles.langText, { color: theme.colors.textSecondary }]}>{repo.stars.toLocaleString()}</Text>
                </View>
            </View>
        </Pressable>
    );
});

export const SyncReposSheet = React.memo(React.forwardRef<BottomSheetModal, SyncReposSheetProps>(
    ({ onClose }, ref) => {
        const { theme } = useUnistyles();

        // View state: 'list' | 'machines' | 'addMachine' | 'folders'
        const [view, setView] = React.useState<'list' | 'machines' | 'addMachine' | 'folders'>('list');
        const [selected, setSelected] = React.useState<Set<string>>(new Set());
        const [reposWithBindings, setReposWithBindings] = React.useState<RepoWithBinding[]>([]);
        const [currentFolderIndex, setCurrentFolderIndex] = React.useState(0);
        const [bindingMachineId, setBindingMachineId] = React.useState<string | null>(null);
        const [folderPath, setFolderPath] = React.useState('');

        // Add machine form state
        const [addMethod, setAddMethod] = React.useState<AddMethod>(null);
        const [manualUrl, setManualUrl] = React.useState('');
        const [urlError, setUrlError] = React.useState('');
        const [isConnecting, setIsConnecting] = React.useState(false);
        const [isRegistered, setIsRegistered] = React.useState(false);

        // Get machines from storage
        const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;
        const onlineMachines = React.useMemo(() => Object.values(machines).filter(m => isMachineOnline(m)), [machines]);

        const dockerCommand = React.useMemo(() => generateDockerCommand(`pending-${Date.now()}`), []);

        const allSelected = selected.size === MOCK_GITHUB_REPOS_TO_ADD.length;
        const someSelected = selected.size > 0;

        // ---- Repo List Handlers ----
        const handleToggleAll = () => {
            if (allSelected) setSelected(new Set());
            else setSelected(new Set(MOCK_GITHUB_REPOS_TO_ADD.map((r) => r.fullName)));
        };

        const handleToggle = (fullName: string) => {
            setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(fullName)) next.delete(fullName);
                else next.add(fullName);
                return next;
            });
        };

        const handleAddSelected = () => {
            const reposToBind = MOCK_GITHUB_REPOS_TO_ADD.filter((r) => selected.has(r.fullName)).map((repo) => ({ repo }));
            setReposWithBindings(reposToBind);
            setCurrentFolderIndex(0);
            setView('machines');
        };

        const handleMachineSelected = (machineId: string) => {
            setBindingMachineId(machineId);
            // Set initial folder path based on machine's home dir and first repo name
            const machine = machines[machineId];
            const homeDir = machine?.metadata?.homeDir || '/';
            const firstRepoName = reposWithBindings[0]?.repo.name || '';
            setFolderPath(`${homeDir.replace(/\/$/, '')}/${firstRepoName}`);
            setView('folders');
        };

        const handleFolderPathConfirm = () => {
            if (!folderPath.trim()) return;

            // Update current repo's path
            setReposWithBindings((prev) => {
                const updated = [...prev];
                updated[currentFolderIndex] = { ...updated[currentFolderIndex], path: folderPath.trim() };
                return updated;
            });

            // Move to next repo or finalize
            const nextIndex = currentFolderIndex + 1;
            if (nextIndex < reposWithBindings.length) {
                setCurrentFolderIndex(nextIndex);
                // Set path for next repo
                const machine = machines[bindingMachineId!];
                const homeDir = machine?.metadata?.homeDir || '/';
                const nextRepoName = reposWithBindings[nextIndex]?.repo.name || '';
                setFolderPath(`${homeDir.replace(/\/$/, '')}/${nextRepoName}`);
            } else {
                // All done - add repos
                const now = new Date().toISOString();
                for (const { repo, path } of reposWithBindings) {
                    setPendingCreatingRepo({ ...repo, lastSyncedAt: now, machineId: bindingMachineId || undefined, bindingPath: path });
                }
                setView('list');
                setSelected(new Set());
                onClose();
            }
        };

        // ---- Add Machine Handlers ----
        const handleCopyCommand = () => showToast(t('lab.machineCopied'));

        const handleManualConnect = () => {
            if (!manualUrl.trim()) return;
            if (!validateUrl(manualUrl.trim())) { setUrlError(t('lab.machineManualUrlInvalid')); return; }
            setUrlError('');
            setIsConnecting(true);
            const machineId = `lab-mach-${Date.now()}`;
            setTimeout(() => {
                setIsConnecting(false);
                setIsRegistered(true);
                addMockLabMachine({ id: machineId, type: 'cloud', name: new URL(manualUrl.trim()).hostname, host: manualUrl.trim(), status: 'creating', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), creatingProgress: 0, registeredVia: 'manual' });
            }, 3000);
        };

        const handleQrSimulate = () => {
            const machineId = `lab-mach-${Date.now()}`;
            setIsConnecting(true);
            setTimeout(() => {
                setIsConnecting(false);
                setIsRegistered(true);
                addMockLabMachine({ id: machineId, type: 'local', name: 'Scanned Machine', host: 'local-agent', status: 'creating', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), creatingProgress: 0, registeredVia: 'qr' });
            }, 10000);
        };

        const handleDockerSimulate = () => {
            const machineId = `lab-mach-${Date.now()}`;
            setIsConnecting(true);
            setTimeout(() => {
                setIsConnecting(false);
                setIsRegistered(true);
                addMockLabMachine({ id: machineId, type: 'cloud', name: 'Docker Agent', host: 'localhost:3000', status: 'creating', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), creatingProgress: 0, registeredVia: 'docker' });
            }, 5000);
        };

        const handleServerSimulate = () => {
            const machineId = `lab-mach-${Date.now()}`;
            setIsConnecting(true);
            setTimeout(() => {
                setIsConnecting(false);
                setIsRegistered(true);
                addMockLabMachine({ id: machineId, type: 'cloud', name: 'Server Cloud', host: 'cloud.server-managed', status: 'creating', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), creatingProgress: 0, registeredVia: 'server' });
            }, 8000);
        };

        const handleDismiss = () => {
            setView('list');
            setSelected(new Set());
            setReposWithBindings([]);
            setCurrentFolderIndex(0);
            setBindingMachineId(null);
            setAddMethod(null);
            setManualUrl('');
            setUrlError('');
            setIsConnecting(false);
            setIsRegistered(false);
            onClose();
        };

        const renderBackdrop = (props: any) => (
            <BottomSheetBackdrop {...props} opacity={0.4} appearsOnIndex={0} disappearsOnIndex={-1} />
        );

        // ---- View: Repo List ----
        const renderRepoList = () => (
            <>
                <View style={styles.header}>
                    <Pressable onPress={handleDismiss} hitSlop={12}>
                        <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                    <Text style={styles.headerTitle}>{t('lab.syncFromGithub')}</Text>
                    <View style={{ width: 22 }} />
                </View>
                <Pressable onPress={handleToggleAll} style={[styles.selectAll, { borderBottomColor: theme.colors.divider }]}>
                    <Ionicons name={allSelected ? 'checkbox' : someSelected ? 'checkbox-outline' : 'square-outline'} size={20} color={allSelected || someSelected ? '#007AFF' : theme.colors.textSecondary} />
                    <Text style={[styles.selectAllText, { color: theme.colors.text }]}>{t('lab.selectAll')}</Text>
                    <Text style={styles.selectCount}>{selected.size}/{MOCK_GITHUB_REPOS_TO_ADD.length}</Text>
                </Pressable>
                <BottomSheetFlatList
                    data={MOCK_GITHUB_REPOS_TO_ADD}
                    keyExtractor={(item: RepoInfo) => item.fullName}
                    renderItem={({ item }: { item: RepoInfo }) => <RepoItem repo={item} isSelected={selected.has(item.fullName)} onToggle={() => handleToggle(item.fullName)} />}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('lab.noGithubRepos')}</Text></View>}
                />
                <View style={styles.footer}>
                    <Pressable onPress={handleAddSelected} disabled={!someSelected} style={[styles.addButton, { backgroundColor: someSelected ? '#007AFF' : theme.colors.surfaceHighest }]}>
                        <Text style={[styles.addButtonText, { color: someSelected ? '#fff' : theme.colors.textSecondary }]}>
                            {t('lab.addSelected')} ({selected.size})
                        </Text>
                    </Pressable>
                </View>
            </>
        );

        // ---- View: Machine List ----
        const renderMachineList = () => {
            const currentRepoName = reposWithBindings[currentFolderIndex]?.repo.name || '';
            return (
                <>
                    <View style={styles.header}>
                        <Pressable style={styles.backButton} onPress={() => setView('list')}>
                            <Ionicons name="chevron-back" size={20} color="#007AFF" />
                            <Text style={styles.backButtonText}>Back</Text>
                        </Pressable>
                        <Text style={styles.headerTitle}>Select Machine</Text>
                        <View style={{ width: 60 }} />
                    </View>
                    <ScrollView style={styles.machineListContainer} contentContainerStyle={{ flexGrow: 1 }}>
                        {onlineMachines.length === 0 ? (
                            <View style={styles.empty}><Text style={styles.emptyText}>{t('repoSettings.noMachineAvailable')}</Text></View>
                        ) : (
                            onlineMachines.map((machine) => (
                                <Pressable key={machine.id} style={[styles.machineItem, { borderBottomColor: theme.colors.divider }]} onPress={() => handleMachineSelected(machine.id)}>
                                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#34C759' }} />
                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <Text style={[styles.machineItemText, { color: theme.colors.text }]}>{machine.metadata?.displayName || machine.metadata?.host || machine.id}</Text>
                                        {machine.metadata?.homeDir && <Text style={[styles.machineItemSubtext, { color: theme.colors.textSecondary }]}>{machine.metadata.homeDir}</Text>}
                                    </View>
                                    <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                                </Pressable>
                            ))
                        )}
                        <View style={styles.addMachineSection}>
                            <Pressable style={styles.addMachineButton} onPress={() => setView('addMachine')}>
                                <Ionicons name="add-circle" size={22} color="#007AFF" />
                                <Text style={styles.addMachineButtonText}>Add New Machine</Text>
                            </Pressable>
                        </View>
                    </ScrollView>
                    <View style={styles.footerBack}>
                        <Text style={styles.footerBackText}>Adding: {currentRepoName}</Text>
                    </View>
                </>
            );
        };

        // ---- View: Add Machine ----
        const renderAddMachine = () => (
            <>
                <View style={styles.header}>
                    <Pressable style={styles.backButton} onPress={() => { setView('machines'); setAddMethod(null); setManualUrl(''); setUrlError(''); setIsRegistered(false); }}>
                        <Ionicons name="chevron-back" size={20} color="#007AFF" />
                        <Text style={styles.backButtonText}>Back</Text>
                    </Pressable>
                    <Text style={styles.headerTitle}>{t('lab.machineRegisterTitle')}</Text>
                    <View style={{ width: 60 }} />
                </View>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.formContent}>
                    {isRegistered ? (
                        <View style={styles.successCard}>
                            <Ionicons name="checkmark-circle" size={22} color="#34C759" />
                            <Text style={styles.successText}>Machine added! Go back to select it.</Text>
                        </View>
                    ) : (
                        <>
                            <View style={[styles.methodCard, addMethod === 'qr' && styles.methodCardActive]}>
                                <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'qr' ? null : 'qr')}>
                                    <View style={[styles.methodIconBox, { backgroundColor: '#007AFF15' }]}><Ionicons name="qr-code-outline" size={22} color="#007AFF" /></View>
                                    <View style={{ flex: 1 }}><Text style={styles.methodTitle}>{t('lab.machineQrTitle')}</Text><Text style={styles.methodSubtitle}>{t('lab.machineQrSubtitle')}</Text></View>
                                    <Ionicons name={addMethod === 'qr' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                                {addMethod === 'qr' && <View style={styles.methodBody}>
                                    <Text style={styles.methodSubtitle}>Scan QR code to pair your machine</Text>
                                    {isConnecting ? <Text style={{ marginTop: 12, color: '#007AFF' }}>Waiting for scan…</Text> : <RoundButton title="Simulate Scan" size="normal" onPress={handleQrSimulate} style={{ marginTop: 12 }} />}
                                </View>}
                            </View>
                            <View style={[styles.methodCard, addMethod === 'docker' && styles.methodCardActive]}>
                                <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'docker' ? null : 'docker')}>
                                    <View style={[styles.methodIconBox, { backgroundColor: '#2496ED15' }]}><Ionicons name="logo-docker" size={22} color="#2496ED" /></View>
                                    <View style={{ flex: 1 }}><Text style={styles.methodTitle}>{t('lab.machineDockerTitle')}</Text><Text style={styles.methodSubtitle}>{t('lab.machineDockerSubtitle')}</Text></View>
                                    <Ionicons name={addMethod === 'docker' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                                {addMethod === 'docker' && <View style={styles.methodBody}>
                                    <View style={styles.commandBox}><Text style={styles.commandText} numberOfLines={1}>{dockerCommand}</Text><Pressable style={styles.copyButton} onPress={handleCopyCommand}><Text style={styles.copyButtonText}>Copy</Text></Pressable></View>
                                    {isConnecting ? <Text style={{ marginTop: 12, color: '#007AFF' }}>Waiting for agent to connect…</Text> : <RoundButton title="Simulate Connection" size="normal" onPress={handleDockerSimulate} style={{ marginTop: 12 }} />}
                                </View>}
                            </View>
                            <View style={[styles.methodCard, addMethod === 'manual' && styles.methodCardActive]}>
                                <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'manual' ? null : 'manual')}>
                                    <View style={[styles.methodIconBox, { backgroundColor: '#5AC8FA15' }]}><Ionicons name="link-outline" size={22} color="#5AC8FA" /></View>
                                    <View style={{ flex: 1 }}><Text style={styles.methodTitle}>{t('lab.machineManualTitle')}</Text><Text style={styles.methodSubtitle}>{t('lab.machineManualSubtitle')}</Text></View>
                                    <Ionicons name={addMethod === 'manual' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                                {addMethod === 'manual' && <View style={styles.methodBody}>
                                    <TextInput style={{ backgroundColor: theme.colors.surfaceHighest, borderRadius: 8, borderWidth: 1, borderColor: urlError ? '#FF3B30' : theme.colors.divider, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text }} placeholder={t('lab.machineManualPlaceholder')} placeholderTextColor={theme.colors.textSecondary} value={manualUrl} onChangeText={(text) => { setManualUrl(text); setUrlError(''); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!isConnecting} />
                                    {urlError ? <Text style={{ fontSize: 12, color: '#FF3B30', marginTop: 4 }}>{urlError}</Text> : null}
                                    <RoundButton title={t('lab.machineManualConnect')} size="normal" onPress={handleManualConnect} loading={isConnecting} disabled={!manualUrl.trim()} style={{ marginTop: 12 }} />
                                </View>}
                            </View>
                            <View style={[styles.methodCard, addMethod === 'server' && styles.methodCardActive]}>
                                <Pressable style={styles.methodHeader} onPress={() => setAddMethod(addMethod === 'server' ? null : 'server')}>
                                    <View style={[styles.methodIconBox, { backgroundColor: '#5856D615' }]}><Ionicons name="cloud-outline" size={22} color="#5856D6" /></View>
                                    <View style={{ flex: 1 }}><Text style={styles.methodTitle}>{t('lab.machineServerTitle')}</Text><Text style={styles.methodSubtitle}>{t('lab.machineServerSubtitle')}</Text></View>
                                    <Ionicons name={addMethod === 'server' ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                                {addMethod === 'server' && <View style={styles.methodBody}>
                                    {isConnecting ? <Text style={{ color: '#5856D6' }}>Creating cloud machine...</Text> : <RoundButton title="Create Server Machine" size="normal" onPress={handleServerSimulate} style={{ marginTop: 12 }} />}
                                </View>}
                            </View>
                        </>
                    )}
                </ScrollView>
            </>
        );

        // ---- View: Folder Path ----
        const renderFolderPath = () => {
            const currentRepo = reposWithBindings[currentFolderIndex];
            const machine = machines[bindingMachineId || ''];
            const machineName = machine?.metadata?.displayName || machine?.metadata?.host || bindingMachineId || '';
            return (
                <>
                    <View style={styles.header}>
                        <Pressable style={styles.backButton} onPress={() => setView('machines')}>
                            <Ionicons name="chevron-back" size={20} color="#007AFF" />
                            <Text style={styles.backButtonText}>Back</Text>
                        </Pressable>
                        <Text style={styles.headerTitle}>Set Path</Text>
                        <View style={{ width: 60 }} />
                    </View>
                    <View style={styles.folderPathContainer}>
                        <Text style={styles.folderProgress}>
                            {t('lab.addSelected')} ({currentFolderIndex + 1}/{reposWithBindings.length}): {currentRepo?.repo.fullName}
                        </Text>
                        <Text style={[styles.folderPathTitle, { color: theme.colors.text }]}>Machine: {machineName}</Text>
                        <TextInput
                            style={[styles.folderPathInput, { borderColor: theme.colors.divider }]}
                            value={folderPath}
                            onChangeText={setFolderPath}
                            placeholder="/path/to/repo"
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={styles.folderPathHint}>
                            This is where the repository code will be stored on {machineName}
                        </Text>
                        <View style={styles.folderPathFooter}>
                            <Pressable
                                style={[styles.folderPathButton, { backgroundColor: theme.colors.surfaceHighest }]}
                                onPress={() => setView('machines')}
                            >
                                <Text style={[styles.folderPathButtonText, { color: theme.colors.text }]}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.folderPathButton, { backgroundColor: '#007AFF' }]}
                                onPress={handleFolderPathConfirm}
                            >
                                <Text style={[styles.folderPathButtonText, { color: '#fff' }]}>
                                    {currentFolderIndex + 1 < reposWithBindings.length ? 'Next' : 'Done'}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </>
            );
        };

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
                    {view === 'list' && renderRepoList()}
                    {view === 'machines' && renderMachineList()}
                    {view === 'addMachine' && renderAddMachine()}
                    {view === 'folders' && renderFolderPath()}
                </View>
            </BottomSheetModal>
        );
    }
));
