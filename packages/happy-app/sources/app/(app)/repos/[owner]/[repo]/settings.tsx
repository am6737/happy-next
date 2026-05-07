import * as React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Avatar } from '@/components/Avatar';
import { Modal } from '@/modal';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { ScheduleCronSheet } from '@/components/ScheduleCronSheet';
import { BranchSelectSheet } from '@/components/BranchSelectSheet';
import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { Switch } from '@/components/Switch';
import {
    MOCK_REPOS,
    getAutomationRule,
    getCronLabel,
    type RepoInfo,
    type AutomationRule,
} from '@/data/mockRepos';
import { formatTimeAgo } from '@/data/repoUtils';
import { t } from '@/text';
import { useProfile, storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    settingsContent: {
        gap: 0,
        padding: 0,
        paddingBottom: 32,
    },
    labelChip: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    labelChipText: {
        fontSize: 12,
        fontWeight: '600',
    },
    triggerLabelsSection: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
    },
    triggerLabelsTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    triggerLabelsFooter: {
        fontSize: 12,
        marginTop: 2,
    },
    labelsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
    },
    dangerZone: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: '#FF3B30',
        borderRadius: 12,
        marginHorizontal: 16,
        marginTop: 24,
        marginBottom: 32,
        overflow: 'hidden',
    },
    dangerHeader: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: '#FF3BB015',
    },
    dangerHeaderText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#FF3B30',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    machineCard: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    machineName: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    machinePath: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        marginTop: 2,
    },
    machineMeta: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    machinePickerTitle: {
        fontSize: 17,
        fontWeight: '600',
        textAlign: 'center',
        paddingVertical: 12,
    },
    machinePickerItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
}));

export default function RepoSettingsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const fullName = `${owner}/${repoName}`;
    const repoInfo = MOCK_REPOS.find((r) => r.fullName === fullName);
    const automationRule = getAutomationRule(fullName);

    const [syncLoading, setSyncLoading] = React.useState(false);
    const profile = useProfile();
    const scheduleCronSheetRef = React.useRef<BottomSheetModal>(null);
    const branchSheetRef = React.useRef<BottomSheetModal>(null);
    const [selectedBranch, setSelectedBranch] = React.useState<string>(repoInfo?.defaultBranch ?? 'main');
    const [automation, setAutomation] = React.useState<AutomationRule>(automationRule);

    // Folder picker for registering repo on machine
    const folderPickerRef = React.useRef<BottomSheetModal>(null);
    const [selectedMachineForRegistration, setSelectedMachineForRegistration] = React.useState<string | null>(null);

    // Machine picker sheet ref
    const machinePickerRef = React.useRef<BottomSheetModal>(null);

    // Inline confirm state for path confirmation (in FolderPickerSheet)
    const [inlineConfirmInitial, setInlineConfirmInitial] = React.useState<{
        parentPath: string;
        repoName: string;
        fullPath: string;
    } | null>(null);
    const [editedFullPath, setEditedFullPath] = React.useState('');
    const [pathConfirmLoading, setPathConfirmLoading] = React.useState(false);
    // MOCK: for testing UI binding效果 - set to true when mock registration succeeds
    const [mockBindingSuccess, setMockBindingSuccess] = React.useState(false);

    // Get all machines from storage (reactive to ensure boundMachineInfo updates after registration)
    const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;

    // Get all machines (not just registered ones for this repo)
    const allMachines = React.useMemo(() => {
        return Object.values(machines);
    }, [machines]);

    // Get online machines only for selection
    const onlineMachines = React.useMemo(() => {
        return allMachines.filter(m => isMachineOnline(m));
    }, [allMachines]);

    // Handler to open machine picker then folder picker
    const handleSelectMachine = React.useCallback(() => {
        if (onlineMachines.length === 0) {
            Modal.alert(t('repoSettings.noMachineAvailable'), t('repoSettings.noMachineAvailableNewSession'));
            return;
        }
        machinePickerRef.current?.present();
    }, [onlineMachines.length]);

    // Handler when user selects a machine from picker
    const handleMachineSelected = React.useCallback((machineId: string) => {
        machinePickerRef.current?.dismiss();
        setSelectedMachineForRegistration(machineId);
        // Pre-compute inline confirm initial state based on machine's home dir
        const machine = machines[machineId];
        const homeDir = machine?.metadata?.homeDir || '/';
        const repoDisplayName = repoName || '';
        const fullPath = `${homeDir.replace(/\/$/, '')}/${repoDisplayName}`;
        setInlineConfirmInitial({
            parentPath: homeDir,
            repoName: repoDisplayName,
            fullPath,
        });
        setEditedFullPath(fullPath);
        folderPickerRef.current?.present();
    }, [machines, repoName]);

    // Handler to change machine (unregister from current and register on new)
    const handleChangeMachine = React.useCallback(() => {
        if (onlineMachines.length === 0) {
            Modal.alert(t('repoSettings.noMachineAvailable'), t('repoSettings.noMachineAvailableNewSession'));
            return;
        }
        machinePickerRef.current?.present();
    }, [onlineMachines.length]);

    // Handle inline confirm from FolderPickerSheet - does the actual registration (MOCK: no real bash)
    const handlePathConfirm = React.useCallback(async (finalPath: string) => {
        if (!selectedMachineForRegistration) return;

        setPathConfirmLoading(true);

        try {
            // MOCK: just show UI binding success without any real logic
            setMockBindingSuccess(true);
            setEditedFullPath(finalPath);

            folderPickerRef.current?.dismiss();
            setSelectedMachineForRegistration(null);
            setInlineConfirmInitial(null);
        } finally {
            setPathConfirmLoading(false);
        }
    }, [selectedMachineForRegistration]);

    // Handle cancel of inline confirm - return to folder browsing
    const handleInlineConfirmCancel = React.useCallback(() => {
        setInlineConfirmInitial(null);
    }, []);

    // Registered repos for this repo across all machines - reactive to storage changes
    const allRegisteredRepos = storage(useShallow((state) => state.registeredRepos)) as Record<string, RegisteredRepo[]>;
    const registeredRepos = React.useMemo(() => {
        return Object.entries(allRegisteredRepos)
            .flatMap(([machineId, repos]: [string, RegisteredRepo[]]) =>
                repos
                    .filter((r) => r.path?.includes(`${owner}/${repoName}`))
                    .map((r) => ({ ...r, machineId }))
            );
    }, [allRegisteredRepos, owner, repoName]);

    // Get the FIRST registered repo for this repo (one repo = one machine)
    const boundMachineInfo = React.useMemo(() => {
        // MOCK: if mock binding success, show bound UI immediately for testing
        if (mockBindingSuccess) {
            const mockMachineId = selectedMachineForRegistration || Object.keys(machines)[0] || 'mock-machine';
            const existingMachine = machines[mockMachineId];
            // Create a mock machine - always ensure we have displayName for UI testing
            const mockMachine: Machine = {
                id: mockMachineId,
                metadata: {
                    displayName: existingMachine?.metadata?.displayName || existingMachine?.metadata?.host || 'MacBook-Pro',
                    host: existingMachine?.metadata?.host || 'localhost',
                    homeDir: existingMachine?.metadata?.homeDir || '/Users/test',
                },
            } as Machine;
            const mockRepo = {
                id: 'mock-repo-id',
                path: editedFullPath || '/mock/path',
                displayName: repoName || 'Mock Repo',
                defaultTargetBranch: 'main',
                machineId: mockMachineId,
            };
            return { regRepo: mockRepo, machine: mockMachine };
        }
        if (registeredRepos.length === 0) return null;
        const first = registeredRepos[0];
        const machine = machines[first.machineId];
        return { regRepo: first, machine };
    }, [registeredRepos, machines, mockBindingSuccess, editedFullPath, selectedMachineForRegistration, repoName]);

    // Check if repo has at least one available (online) machine
    const hasAvailableMachine = registeredRepos.some(regRepo => {
        const machine = machines[regRepo.machineId];
        return machine && isMachineOnline(machine);
    });

    const handleSync = React.useCallback(() => {
        setSyncLoading(true);
        setTimeout(() => setSyncLoading(false), 1500);
    }, []);

    const handleRemoveRepo = React.useCallback(() => {
        Modal.alert(
            t('repoSettings.removeRepoTitle'),
            t('repoSettings.removeRepoMessage', { repo: fullName })
        );
    }, [fullName]);

    const handleClearSessions = React.useCallback(() => {
        Modal.alert(
            t('repoSettings.clearSessionsTitle'),
            t('repoSettings.clearSessionsMessage', { repo: fullName })
        );
    }, [fullName]);

    // Derive available labels from the repo's actual issue labels (need to import issues)
    // For now, use fallback labels - this could be improved by passing issues as a param
    const availableLabels = ['bug', 'enhancement', 'feature', 'documentation', 'good-first-issue'];

    const getLabelColor = React.useCallback((labelName: string): string | undefined => {
        // MOCK: return predefined colors for common labels
        const colors: Record<string, string> = {
            bug: 'd73a4a',
            enhancement: 'a2eeef',
            feature: 'b60205',
            documentation: '0075ca',
            'good-first-issue': '7057ff',
        };
        return colors[labelName];
    }, []);

    const toggleLabel = React.useCallback((label: string) => {
        setAutomation((prev) => ({
            ...prev,
            triggerLabels: prev.triggerLabels.includes(label)
                ? prev.triggerLabels.filter((l) => l !== label)
                : [...prev.triggerLabels, label],
        }));
    }, []);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: 'Settings', headerBackTitle: t('common.back') }} />

            <ScrollView contentContainerStyle={styles.settingsContent}>
                {/* ===== GITHUB SYNC ===== */}
                <ItemGroup title={t('repoSettings.githubSync')}>
                    <Item
                        title={t('repoSettings.githubAccount')}
                        leftElement={
                            profile?.github ? (
                                <Avatar id={String(profile.github.id)} imageUrl={profile.github.avatar_url} size={29} />
                            ) : undefined
                        }
                        detail={profile?.github?.login ?? t('repoSettings.notConnected')}
                    />
                    <Item
                        title={t('repoSettings.lastSynced')}
                        detail={repoInfo?.lastSyncedAt ? formatTimeAgo(repoInfo.lastSyncedAt) : t('repoSettings.never')}
                    />
                    <Item
                        title={t('repoSettings.syncNow')}
                        onPress={handleSync}
                        loading={syncLoading}
                        rightElement={
                            <Ionicons name="sync" size={20} color={theme.colors.textSecondary} />
                        }
                    />
                </ItemGroup>

                {/* ===== MACHINE (Single Binding) ===== */}
                <ItemGroup title={t('repoSettings.machines')} footer={t('repoSettings.machinesFooter')}>
                    {boundMachineInfo ? (
                        // CASE: Repo is bound to a machine
                        <View style={[styles.machineCard, { borderBottomWidth: 0 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#34C759' }} />
                                    <Text style={styles.machineName} numberOfLines={1}>
                                        {boundMachineInfo.machine?.metadata?.displayName || boundMachineInfo.machine?.metadata?.host || boundMachineInfo.machine?.id || boundMachineInfo.regRepo.machineId}
                                    </Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: hasAvailableMachine ? '#34C759' : '#999' }} />
                                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                                        {hasAvailableMachine ? t('repoSettings.machineOnline') : t('repoSettings.machineOffline')}
                                    </Text>
                                </View>
                            </View>
                            {boundMachineInfo.regRepo.path && (
                                <Text style={[styles.machinePath, { marginTop: 8 }]} numberOfLines={1}>
                                    {boundMachineInfo.regRepo.path}
                                </Text>
                            )}
                            {boundMachineInfo.regRepo.defaultTargetBranch && (
                                <Text style={[styles.machineMeta, { marginTop: 4 }]}>
                                    {t('repoSettings.targetBranch')}: {boundMachineInfo.regRepo.defaultTargetBranch}
                                </Text>
                            )}
                            <Pressable
                                onPress={handleChangeMachine}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 }}
                            >
                                <Ionicons name="swap-horizontal" size={16} color={theme.colors.textLink} />
                                <Text style={{ fontSize: 13, color: theme.colors.textLink }}>
                                    {t('repoSettings.changeMachine')}
                                </Text>
                            </Pressable>
                        </View>
                    ) : (
                        // CASE: Repo is NOT bound to any machine
                        <View style={[styles.machineCard, { borderBottomWidth: 0 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Ionicons name="warning" size={20} color="#FF9500" />
                                <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                                    {t('repoSettings.notBound')}
                                </Text>
                            </View>
                            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 12 }}>
                                {t('repoSettings.notBoundDesc')}
                            </Text>
                            <Pressable
                                onPress={handleSelectMachine}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                            >
                                <Ionicons name="add-circle" size={18} color={theme.colors.textLink} />
                                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.textLink }}>
                                    {t('repoSettings.selectMachine')}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                </ItemGroup>

                {/* ===== AUTO PILOT ===== */}
                <ItemGroup title={t('repoSettings.autoPilot')}>
                    <Item
                        title={t('repoSettings.automationEnabled')}
                        subtitle={t('repoSettings.automationEnabledDesc')}
                        showChevron={false}
                        rightElement={
                            <Switch
                                value={automation.enabled}
                                onValueChange={(val) => setAutomation((prev) => ({ ...prev, enabled: val }))}
                            />
                        }
                    />
                    {automation.enabled && (
                        <>
                            <Item
                                title={t('repoSettings.autoPilotNewIssues')}
                                subtitle={t('repoSettings.autoPilotNewIssuesDesc')}
                                showChevron={false}
                                rightElement={
                                    <Switch
                                        value={automation.autoPilotNewIssues}
                                        onValueChange={(val) => setAutomation((prev) => ({ ...prev, autoPilotNewIssues: val }))}
                                    />
                                }
                            />
                            <Item
                                title={t('repoSettings.scheduled')}
                                subtitle={getCronLabel(automation.scheduleCron)}
                                onPress={() => scheduleCronSheetRef.current?.present()}
                            />
                            <View style={[styles.triggerLabelsSection, { borderColor: theme.colors.divider }]}>
                                <Text style={[styles.triggerLabelsTitle, { color: theme.colors.text }]}>
                                    {t('repoSettings.triggerLabels')}
                                </Text>
                                <Text style={[styles.triggerLabelsFooter, { color: theme.colors.textSecondary }]}>
                                    {t('repoSettings.triggerLabelsFooter')}
                                </Text>
                                <View style={styles.labelsContainer}>
                                    {availableLabels.map((label) => {
                                        const active = automation.triggerLabels.includes(label);
                                        const labelColor = getLabelColor(label);
                                        return (
                                            <Pressable
                                                key={label}
                                                style={[
                                                    styles.labelChip,
                                                    active && labelColor && {
                                                        backgroundColor: `#${labelColor}25`,
                                                    },
                                                    active && !labelColor && {
                                                        backgroundColor: `${theme.colors.button.primary.background}25`,
                                                    },
                                                    !active && {
                                                        backgroundColor: theme.colors.surfaceHighest,
                                                    },
                                                ]}
                                                onPress={() => toggleLabel(label)}
                                            >
                                                <Text
                                                    style={[
                                                        styles.labelChipText,
                                                        active && labelColor && { color: `#${labelColor}` },
                                                        active && !labelColor && { color: theme.colors.button.primary.background },
                                                        !active && { color: theme.colors.textSecondary },
                                                    ]}
                                                >
                                                    {label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>
                        </>
                    )}
                </ItemGroup>

                {/* ===== DANGER ZONE ===== */}
                <View style={styles.dangerZone}>
                    <View style={styles.dangerHeader}>
                        <Text style={styles.dangerHeaderText}>{t('repoSettings.dangerZone')}</Text>
                    </View>
                    <Item
                        title={t('repoSettings.removeRepo')}
                        subtitle={t('repoSettings.removeRepoDesc')}
                        destructive
                        onPress={handleRemoveRepo}
                    />
                    <Item
                        title={t('repoSettings.clearSessions')}
                        subtitle={t('repoSettings.clearSessionsDesc')}
                        destructive
                        onPress={handleClearSessions}
                    />
                </View>
            </ScrollView>

            <ScheduleCronSheet
                ref={scheduleCronSheetRef}
                scheduleCron={automation.scheduleCron}
                onChange={(cron) => setAutomation((prev) => ({ ...prev, scheduleCron: cron }))}
            />

            <FolderPickerSheet
                ref={folderPickerRef}
                machineId={selectedMachineForRegistration || ''}
                homeDir={selectedMachineForRegistration ? machines[selectedMachineForRegistration]?.metadata?.homeDir : undefined}
                inlineConfirm
                inlineConfirmInitial={inlineConfirmInitial ?? undefined}
                onInlineConfirm={handlePathConfirm}
                onInlineConfirmCancel={handleInlineConfirmCancel}
            />

            {/* Machine Picker Sheet */}
            <BottomSheetModal
                ref={machinePickerRef}
                snapPoints={['50%']}
                enableDynamicSizing={false}
                backdropComponent={(props) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />}
                backgroundStyle={{ backgroundColor: theme.colors.surface }}
                handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
            >
                <View style={{ flex: 1 }}>
                    <Text style={[styles.machinePickerTitle, { color: theme.colors.text }]}>
                        {t('repoSettings.selectMachine')}
                    </Text>
                    <BottomSheetFlatList
                        data={onlineMachines}
                        keyExtractor={(item: Machine) => item.id}
                        renderItem={({ item }: { item: Machine }) => (
                            <Pressable
                                style={[styles.machinePickerItem, { borderBottomColor: theme.colors.divider }]}
                                onPress={() => handleMachineSelected(item.id)}
                            >
                                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#34C759' }} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                                        {item.metadata?.displayName || item.metadata?.host || item.id}
                                    </Text>
                                    {item.metadata?.homeDir && (
                                        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                                            {item.metadata.homeDir}
                                        </Text>
                                    )}
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                            </Pressable>
                        )}
                        ListEmptyComponent={
                            <View style={{ padding: 20, alignItems: 'center' }}>
                                <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
                                    {t('repoSettings.noMachineAvailable')}
                                </Text>
                            </View>
                        }
                        contentContainerStyle={{ paddingBottom: 20 }}
                    />
                </View>
            </BottomSheetModal>
        </View>
    );
}
