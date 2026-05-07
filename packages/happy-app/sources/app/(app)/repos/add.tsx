import * as React from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { SyncReposSheet } from '@/components/SyncReposSheet';
import { RoundButton } from '@/components/RoundButton';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { parseGitHubUrl, parseGitLabUrl, parseGenericGitUrl, setPendingCreatingRepo, type RepoInfo } from '@/data/mockRepos';
import { t } from '@/text';
import { MachinePickerSheet } from '@/components/MachinePickerSheet';
import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import type { Machine } from '@/sync/storageTypes';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: 16,
        paddingTop: 24,
    },
    section: {
        marginBottom: 20,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    input: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('regular'),
    },
    inputError: {
        borderColor: '#FF3B30',
    },
    errorText: {
        fontSize: 12,
        color: '#FF3B30',
        marginTop: 4,
    },
    hintText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    addButton: {
        marginTop: 8,
    },
    dividerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 20,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: theme.colors.divider,
    },
    dividerText: {
        marginHorizontal: 12,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    githubButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    githubButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
}));

export default function AddRepoScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const githubSheetRef = React.useRef<BottomSheetModal>(null);
    const machinePickerRef = React.useRef<BottomSheetModal>(null);
    const folderPickerRef = React.useRef<BottomSheetModal>(null);

    const [url, setUrl] = React.useState('');
    const [username, setUsername] = React.useState('');
    const [token, setToken] = React.useState('');
    const [urlError, setUrlError] = React.useState('');
    const [isAdding, setIsAdding] = React.useState(false);

    // Machine binding state
    const [pendingRepo, setPendingRepo] = React.useState<RepoInfo | null>(null);
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(null);
    const [folderPickerInitialPath, setFolderPickerInitialPath] = React.useState<string | undefined>(undefined);

    // Get machines from storage for suggested path
    const machines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;

    const handleUrlChange = (text: string) => {
        setUrl(text);
        if (urlError) setUrlError('');
    };

    const parseUrl = (): { owner: string; repo: string } | null => {
        const trimmedUrl = url.trim();
        if (!trimmedUrl) return null;

        // Try GitHub, GitLab, then generic git
        return (
            parseGitHubUrl(trimmedUrl) ||
            parseGitLabUrl(trimmedUrl) ||
            parseGenericGitUrl(trimmedUrl)
        );
    };

    const handleAddByUrl = React.useCallback(() => {
        const parsed = parseUrl();
        if (!parsed) {
            setUrlError(t('lab.invalidGitUrl'));
            return;
        }
        setUrlError('');

        const repo: RepoInfo = {
            fullName: `${parsed.owner}/${parsed.repo}`,
            name: parsed.repo,
            owner: parsed.owner,
            description: 'Cloud development workspace',
            language: 'TypeScript',
            stars: 0,
            forks: 0,
            watchers: 0,
            openIssuesCount: 0,
            openPRsCount: 0,
            repoSizeKb: 0,
            createdAt: new Date().toISOString(),
            pushedAt: new Date().toISOString(),
            defaultBranch: 'main',
            branches: ['main'],
            updatedAt: new Date().toISOString(),
            isPrivate: !!username || !!token,
            readme: '',
            // Store credentials for later sync
            ...(username && { syncUsername: username }),
            ...(token && { syncToken: token }),
        };

        setIsAdding(true);
        setPendingRepo(repo);
        machinePickerRef.current?.present();
    }, [url, username, token]);

    const handleMachineSelected = React.useCallback((machineId: string) => {
        machinePickerRef.current?.dismiss();
        setSelectedMachineId(machineId);

        // Compute suggested path based on machine's homeDir
        const machine = machines[machineId];
        const homeDir = machine?.metadata?.homeDir || '/';
        const repoName = pendingRepo?.name || '';
        const suggestedPath = `${homeDir.replace(/\/$/, '')}/${repoName}`;
        setFolderPickerInitialPath(suggestedPath);

        folderPickerRef.current?.present();
    }, [machines, pendingRepo]);

    const handlePathConfirm = React.useCallback((finalPath: string) => {
        if (!pendingRepo || !selectedMachineId) return;

        folderPickerRef.current?.dismiss();

        // Complete the repo with machine binding
        const completeRepo: RepoInfo = {
            ...pendingRepo,
            machineId: selectedMachineId,
            bindingPath: finalPath,
        };

        setPendingCreatingRepo(completeRepo);

        // Reset state
        setPendingRepo(null);
        setSelectedMachineId(null);
        setFolderPickerInitialPath(undefined);
        setIsAdding(false);

        // Navigate back
        setTimeout(() => router.back(), 200);
    }, [pendingRepo, selectedMachineId, router]);

    const handleMachinePickerDismiss = React.useCallback(() => {
        // User dismissed without selecting - reset state
        setPendingRepo(null);
        setSelectedMachineId(null);
        setFolderPickerInitialPath(undefined);
        setIsAdding(false);
    }, []);

    const handleFolderPickerDismiss = React.useCallback(() => {
        // User dismissed folder picker - go back to machine picker
        setFolderPickerInitialPath(undefined);
        machinePickerRef.current?.present();
    }, []);

    const handleOpenGithub = () => {
        githubSheetRef.current?.present();
    };

    const handleGithubSheetClose = () => {
        githubSheetRef.current?.dismiss();
    };

    return (
        <View style={styles.container}>
            <View style={styles.section}>
                <Text style={styles.label}>Repository URL</Text>
                <TextInput
                    style={[styles.input, urlError ? styles.inputError : undefined]}
                    placeholder="https://github.com/owner/repo or git@github.com:owner/repo.git"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={url}
                    onChangeText={handleUrlChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    editable={!isAdding}
                    onSubmitEditing={handleAddByUrl}
                    returnKeyType="go"
                />
                {urlError ? <Text style={styles.errorText}>{urlError}</Text> : null}
                <Text style={styles.hintText}>Enter the full URL to your repository</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.label}>Username (optional)</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Your GitHub or GitLab username"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isAdding}
                />
                <Text style={styles.hintText}>Required for private repositories</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.label}>Access Token / Password (optional)</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Personal access token or password"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={token}
                    onChangeText={setToken}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    editable={!isAdding}
                />
                <Text style={styles.hintText}>Your credentials are stored securely and encrypted</Text>
            </View>

            <View style={styles.addButton}>
                <RoundButton
                    size="large"
                    title={t('lab.addButton')}
                    onPress={handleAddByUrl}
                    disabled={!url.trim() || isAdding}
                    loading={isAdding}
                />
            </View>

            <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
            </View>

            <Pressable
                style={styles.githubButton}
                onPress={handleOpenGithub}
            >
                <Ionicons name="logo-github" size={22} color={theme.colors.text} />
                <Text style={styles.githubButtonText}>Import from GitHub</Text>
            </Pressable>

            <SyncReposSheet
                ref={githubSheetRef}
                onClose={handleGithubSheetClose}
            />

            {/* Machine Picker Sheet */}
            <MachinePickerSheet
                ref={machinePickerRef}
                onSelect={handleMachineSelected}
                onCancel={handleMachinePickerDismiss}
            />

            {/* Folder Picker Sheet */}
            <FolderPickerSheet
                ref={folderPickerRef}
                machineId={selectedMachineId || ''}
                homeDir={selectedMachineId ? machines[selectedMachineId]?.metadata?.homeDir : undefined}
                inlineConfirm
                inlineConfirmInitial={
                    folderPickerInitialPath
                        ? {
                              parentPath: folderPickerInitialPath.split('/').slice(0, -1).join('/') || '/',
                              repoName: folderPickerInitialPath.split('/').pop() || '',
                              fullPath: folderPickerInitialPath,
                          }
                        : undefined
                }
                onInlineConfirm={handlePathConfirm}
                onInlineConfirmCancel={handleFolderPickerDismiss}
            />
        </View>
    );
}
