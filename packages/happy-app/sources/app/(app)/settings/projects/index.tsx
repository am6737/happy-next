import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { loadRegisteredRepos } from '@/sync/repoStore';
import { createAiProject, fetchAiProjectMachineIds, fetchAiProjects, updateAiProject, type AiProject, type AiProjectBinding } from '@/sync/apiAiTeams';
import { withAiMutationIdentity } from '@/sync/aiMutationJournal';
import type { RegisteredRepo } from '@/utils/workspaceRepos';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';

type Candidate = { machineId: string; version: number; repo: RegisteredRepo };

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 64, gap: 18 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14 },
    muted: { color: theme.colors.textSecondary, fontSize: 12 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    section: { gap: 9 },
    row: { minHeight: 48, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 3 },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    input: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, color: theme.colors.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

export default function AiProjectsPage() {
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const { credentials } = useAuth();
    const [projects, setProjects] = React.useState<AiProject[]>([]);
    const [candidates, setCandidates] = React.useState<Candidate[]>([]);
    const [candidate, setCandidate] = React.useState<Candidate | null>(null);
    const [projectId, setProjectId] = React.useState<string | null>(null);
    const [kind, setKind] = React.useState<'local' | 'github'>('local');
    const [name, setName] = React.useState('');
    const [branch, setBranch] = React.useState('main');
    const [repositoryId, setRepositoryId] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const selected = projects.find((item) => item.id === projectId);

    const refresh = React.useCallback(async () => {
        if (!credentials) return;
        const [projectResult, machineIds] = await Promise.all([fetchAiProjects(credentials), fetchAiProjectMachineIds(credentials)]);
        setProjects(projectResult.items);
        const entries = await Promise.all(machineIds.map(async (machineId) => {
            const result = await loadRegisteredRepos(credentials, machineId);
            return result.repos.map((repo) => ({ machineId, version: result.version, repo }));
        }));
        setCandidates(entries.flat());
    }, [credentials?.secret]);

    React.useEffect(() => {
        setProjects([]); setCandidates([]); setCandidate(null); setProjectId(null);
        refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [refresh]);

    const perform = async (work: () => Promise<void>) => {
        setBusy(true); setError(null);
        try { await work(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    const binding = (): AiProjectBinding => {
        if (!candidate) throw new Error(isZh ? '请选择已注册仓库' : 'Select a registered repository');
        const common = { machineId: candidate.machineId, registeredRepoId: candidate.repo.id,
            registeredKvVersion: candidate.version, workingDirectory: candidate.repo.path, defaultBranch: branch.trim() };
        if (kind === 'github') {
            if (!/^\d+$/.test(repositoryId.trim())) throw new Error(isZh ? '填写已授权 GitHub 仓库 ID' : 'Enter an authorized GitHub repository ID');
            return { kind, repositoryId: repositoryId.trim(), ...common };
        }
        return { kind, ...common };
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '项目' : 'Projects' }} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '项目' : 'Projects'} · {projects.length}</Text>
                {projects.map((item) => <Pressable key={item.id} style={[styles.row, projectId === item.id && styles.selected]} onPress={() => {
                    setProjectId(item.id); setName(item.name); setKind(item.snapshot?.kind ?? 'local');
                    setBranch(item.snapshot?.defaultBranch ?? 'main'); setRepositoryId(item.snapshot?.repositoryId ?? '');
                    setCandidate(candidates.find((entry) => entry.machineId === item.snapshot?.machineId && entry.repo.id === item.snapshot?.registeredRepoId) ?? null);
                }}>
                    <Text style={styles.text}>{item.name}</Text>
                    <Text style={styles.muted}>{item.snapshot?.kind ?? '-'} · v{item.version} · {item.active ? (isZh ? '启用' : 'Active') : (isZh ? '停用' : 'Inactive')}</Text>
                    {item.snapshot ? <Text style={styles.muted}>{item.snapshot.defaultBranch} @ {item.snapshot.baseCommit.slice(0, 12)}</Text> : null}
                </Pressable>)}
                {!projects.length ? <Text style={styles.muted}>{isZh ? '暂无项目' : 'No projects'}</Text> : null}
            </View>
            <View style={styles.section}>
                <Text style={styles.heading}>{selected ? (isZh ? '更新项目版本' : 'Update project version') : (isZh ? '新项目' : 'New project')}</Text>
                <View style={styles.actions}>{(['local', 'github'] as const).map((source) => <Pressable key={source} style={[styles.action, kind === source && styles.selected]} onPress={() => setKind(source)}><Ionicons name={source === 'local' ? 'folder-outline' : 'logo-github'} size={17} color={theme.colors.text} /><Text style={styles.actionText}>{source === 'local' ? (isZh ? '本地 Git' : 'Local Git') : 'GitHub'}</Text></Pressable>)}</View>
                <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={isZh ? '项目名称' : 'Project name'} placeholderTextColor={theme.colors.textSecondary} />
                {candidates.map((entry) => <Pressable key={`${entry.machineId}:${entry.repo.id}`} style={[styles.row, candidate?.machineId === entry.machineId && candidate.repo.id === entry.repo.id && styles.selected]} onPress={() => {
                    setCandidate(entry); setBranch(entry.repo.defaultTargetBranch || 'main');
                }}>
                    <Text style={styles.text}>{entry.repo.displayName}</Text>
                    <Text style={styles.muted}>{entry.repo.path} · {entry.machineId.slice(0, 12)} · KV v{entry.version}</Text>
                </Pressable>)}
                {!candidates.length ? <Text style={styles.muted}>{isZh ? '没有已注册的机器仓库' : 'No registered machine repositories'}</Text> : null}
                <TextInput style={styles.input} value={branch} onChangeText={setBranch} placeholder={isZh ? '目标分支' : 'Default branch'} placeholderTextColor={theme.colors.textSecondary} />
                {kind === 'github' ? <TextInput style={styles.input} value={repositoryId} onChangeText={setRepositoryId} keyboardType="number-pad" placeholder={isZh ? '已授权仓库 ID' : 'Authorized repository ID'} placeholderTextColor={theme.colors.textSecondary} /> : null}
                <View style={styles.actions}>
                    <Pressable style={styles.action} disabled={busy || !candidate || !name.trim() || !branch.trim()} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        const input = { ...binding(), name: name.trim() };
                        if (selected) {
                            await updateAiProject(credentials, selected.id, { ...input, expectedVersion: selected.version });
                        } else {
                            await withAiMutationIdentity(credentials, 'project-create', input, (clientRequestId) => createAiProject(credentials, { ...input, clientRequestId }));
                        }
                        await refresh();
                    })}><Ionicons name={selected ? 'save-outline' : 'add'} size={17} color={theme.colors.text} /><Text style={styles.actionText}>{selected ? (isZh ? '更新版本' : 'Update version') : (isZh ? '创建项目' : 'Create project')}</Text></Pressable>
                    {selected?.active ? <Pressable style={styles.action} disabled={busy || !candidate} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        if (!await Modal.confirm(isZh ? '停用此项目？' : 'Disable this project?', selected.name)) return;
                        await updateAiProject(credentials, selected.id, { ...binding(), expectedVersion: selected.version, active: false });
                        await refresh();
                    })}><Ionicons name="pause-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '停用' : 'Disable'}</Text></Pressable> : null}
                    {selected ? <Pressable style={styles.action} onPress={() => { setProjectId(null); setName(''); setCandidate(null); }}><Ionicons name="add-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '新项目' : 'New project'}</Text></Pressable> : null}
                </View>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}
