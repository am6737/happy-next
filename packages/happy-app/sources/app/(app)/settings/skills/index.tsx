import * as React from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { bindAiSkillAgent, createAiSkill, fetchAiSkillDetail, fetchAiSkillProposals, fetchAiSkillVersion, fetchAiSkills, proposeAiSkillLearning, publishAiSkillVersion, reviewAiSkillProposal, rollbackAiSkill, unbindAiSkillAgent, uploadAiSkillVersion, type AiSkillDetail, type AiSkillFile, type AiSkillProposal, type AiSkillSummary, type AiSkillVersion } from '@/sync/apiAiTeams';
import { Modal } from '@/modal';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 64, gap: 18 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    note: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
    row: { minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    rowMeta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 3 },
    field: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.colors.text, backgroundColor: theme.colors.surface },
    editor: { minHeight: 180, textAlignVertical: 'top' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.divider, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
    primary: { backgroundColor: theme.colors.button.primary.background, borderColor: theme.colors.button.primary.background },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
    primaryText: { color: theme.colors.button.primary.tint },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    section: { gap: 8 },
}));

function validSkillPath(path: string): boolean {
    return !!path && !path.startsWith('/') && !path.includes('\\')
        && path.split('/').every((part) => !!part && part !== '.' && part !== '..')
        && /^[A-Za-z0-9._/-]+$/.test(path);
}

function previewSkillFile(file: AiSkillVersion['files'][number], isZh: boolean): string {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(file.contentBase64)); }
    catch { return isZh ? `二进制文件 · SHA-256 ${file.sha256}` : `Binary file · SHA-256 ${file.sha256}`; }
}

export default function AiSkillsPage() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const isZh = getCurrentLanguage().startsWith('zh');
    const { credentials } = useAuth();
    const data = useManagedAiTeamData();
    const [skills, setSkills] = React.useState<AiSkillSummary[]>([]);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [name, setName] = React.useState('');
    const [newTeamId, setNewTeamId] = React.useState<string | null>(null);
    const [skillText, setSkillText] = React.useState('');
    const [files, setFiles] = React.useState<AiSkillFile[]>([]);
    const [uploadedVersion, setUploadedVersion] = React.useState<number | null>(null);
    const [proposal, setProposal] = React.useState('');
    const [detail, setDetail] = React.useState<AiSkillDetail | null>(null);
    const [proposals, setProposals] = React.useState<AiSkillProposal[]>([]);
    const [preview, setPreview] = React.useState<AiSkillVersion | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const selected = skills.find((skill) => skill.id === selectedId);

    const refresh = React.useCallback(async () => {
        if (!credentials) return;
        const result = await fetchAiSkills(credentials);
        setSkills(result.items);
    }, [credentials?.secret]);

    const refreshSelected = React.useCallback(async () => {
        if (!credentials || !selectedId) return;
        const [nextDetail, nextProposals] = await Promise.all([
            fetchAiSkillDetail(credentials, selectedId), fetchAiSkillProposals(credentials, selectedId),
        ]);
        setDetail(nextDetail); setProposals(nextProposals.items);
    }, [credentials?.secret, selectedId]);

    React.useEffect(() => {
        setSkills([]); setSelectedId(null); setDetail(null); setPreview(null); setProposals([]); setError(null);
        refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [refresh]);

    React.useEffect(() => {
        setDetail(null); setPreview(null); setProposals([]);
        refreshSelected().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [refreshSelected]);

    const perform = async (work: () => Promise<void>) => {
        setBusy(true); setError(null);
        try { await work(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    const addFiles = async () => {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        if (result.canceled) return;
        const added: AiSkillFile[] = [];
        for (const asset of result.assets) {
            if (!validSkillPath(asset.name)) throw new Error(isZh ? '文件名不符合 Skill 路径规则' : 'Invalid skill file name');
            const contentBase64 = Platform.OS === 'web' && asset.file
                ? encodeBase64(new Uint8Array(await asset.file.arrayBuffer()))
                : await (require('expo-file-system/legacy') as {
                    readAsStringAsync: (uri: string, options: { encoding: string }) => Promise<string>;
                }).readAsStringAsync(asset.uri, { encoding: 'base64' });
            added.push({ path: asset.name, contentBase64 });
        }
        setFiles((current) => [...current.filter((file) => !added.some((newFile) => newFile.path === file.path)), ...added]);
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? '团队 Skills' : 'Team skills' }} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? 'Skills' : 'Skills'} · {skills.length}</Text>
                {skills.map((skill) => <Pressable key={skill.id} style={[styles.row, selectedId === skill.id && styles.selected]} onPress={() => { setSelectedId(skill.id); setUploadedVersion(null); setFiles([]); setSkillText(''); }}>
                    <Ionicons name="document-text-outline" size={20} color={theme.colors.textSecondary} />
                    <View style={styles.rowBody}><Text style={styles.rowTitle}>{skill.name}</Text><Text style={styles.rowMeta}>{skill.currentVersion ? `v${skill.currentVersion} · ${isZh ? '已发布' : 'Published'}` : (isZh ? '草稿' : 'Draft')}</Text></View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                </Pressable>)}
                {!skills.length ? <Text style={styles.note}>{isZh ? '尚无 Skill' : 'No skills yet'}</Text> : null}
            </View>
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '新建 Skill' : 'New skill'}</Text>
                <TextInput style={styles.field} value={name} onChangeText={setName} placeholder={isZh ? '名称' : 'Name'} placeholderTextColor={theme.colors.textSecondary} />
                <View style={styles.actions}>
                    <Pressable style={[styles.action, newTeamId === null && styles.selected]} disabled={busy} onPress={() => setNewTeamId(null)}><Text style={styles.actionText}>{isZh ? '个人' : 'Personal'}</Text></Pressable>
                    {data.teams.map((team) => <Pressable key={team.id} style={[styles.action, newTeamId === team.id && styles.selected]} disabled={busy} onPress={() => setNewTeamId(team.id)}><Text style={styles.actionText}>{team.name}</Text></Pressable>)}
                </View>
                <View style={styles.actions}><Pressable style={[styles.action, styles.primary]} disabled={busy || !name.trim()} onPress={() => perform(async () => {
                    if (!credentials) throw new Error('Authentication is required');
                    const result = await createAiSkill(credentials, { name: name.trim(), ...(newTeamId ? { teamId: newTeamId } : {}) });
                    await refresh(); setSelectedId(result.id); setName(''); setNewTeamId(null);
                })}><Ionicons name="add" size={17} color={theme.colors.button.primary.tint} /><Text style={[styles.actionText, styles.primaryText]}>{isZh ? '创建' : 'Create'}</Text></Pressable></View>
            </View>
            {selected ? <View style={styles.section}>
                <Text style={styles.heading}>{selected.name}</Text>
                <Text style={styles.note}>{detail?.teamId ? `${isZh ? '团队' : 'Team'}: ${data.teams.find((team) => team.id === detail.teamId)?.name ?? detail.teamId}` : (isZh ? '个人 Skill' : 'Personal skill')}</Text>
                {detail?.versions.map((version) => <View key={version.version} style={styles.row}>
                    <Pressable style={styles.rowBody} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        setPreview(await fetchAiSkillVersion(credentials, selected.id, version.version));
                    })}>
                        <Text style={styles.rowTitle}>v{version.version}{detail.currentVersion === version.version ? (isZh ? ' · 当前' : ' · Current') : ''}</Text>
                        <Text style={styles.rowMeta}>{version.publishedAt ? (isZh ? '已发布' : 'Published') : (isZh ? '待发布' : 'Unpublished')} · {version.contentHash.slice(0, 12)}</Text>
                    </Pressable>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                </View>)}
                {preview?.skillId === selected.id ? <View style={styles.section}>
                    <Text style={styles.heading}>v{preview.version} · {preview.hash}</Text>
                    {preview.files.map((file) => <View key={file.path} style={styles.section}>
                        <Text style={styles.rowTitle}>{file.path} · {file.size} B</Text>
                        <Text selectable style={styles.note}>{previewSkillFile(file, isZh)}</Text>
                    </View>)}
                    {!preview.publishedAt ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        const confirmed = await Modal.confirm(isZh ? '发布此版本？' : 'Publish this version?', `${selected.name} · v${preview.version}`, { confirmText: isZh ? '发布' : 'Publish' });
                        if (!confirmed) return;
                        await publishAiSkillVersion(credentials, selected.id, preview.version);
                        await Promise.all([refresh(), refreshSelected()]);
                        setPreview(await fetchAiSkillVersion(credentials, selected.id, preview.version));
                    })}><Ionicons name="checkmark-circle-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '发布' : 'Publish'}</Text></Pressable> : null}
                    {preview.publishedAt && !preview.isCurrent ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        const confirmed = await Modal.confirm(isZh ? '回滚到此版本？' : 'Roll back to this version?', `${selected.name} · v${preview.version}`, { confirmText: isZh ? '回滚' : 'Roll back' });
                        if (!confirmed) return;
                        await rollbackAiSkill(credentials, selected.id, preview.version);
                        await Promise.all([refresh(), refreshSelected()]);
                        setPreview(await fetchAiSkillVersion(credentials, selected.id, preview.version));
                    })}><Ionicons name="arrow-undo-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '回滚' : 'Roll back'}</Text></Pressable> : null}
                </View> : null}
                <Text style={styles.note}>{isZh ? '新版本' : 'New version'}</Text>
                <TextInput style={[styles.field, styles.editor]} multiline value={skillText} onChangeText={setSkillText} placeholder="SKILL.md" placeholderTextColor={theme.colors.textSecondary} />
                {files.map((file) => <View key={file.path} style={styles.row}><Text style={[styles.rowTitle, styles.rowBody]}>{file.path}</Text><Pressable onPress={() => setFiles((current) => current.filter((item) => item.path !== file.path))}><Ionicons name="close" size={18} color={theme.colors.textSecondary} /></Pressable></View>)}
                <View style={styles.actions}>
                    <Pressable style={styles.action} disabled={busy} onPress={() => perform(addFiles)}><Ionicons name="attach" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '添加支持文件' : 'Add files'}</Text></Pressable>
                    <Pressable style={[styles.action, styles.primary]} disabled={busy || !skillText.trim()} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        const markdown = encodeBase64(new TextEncoder().encode(skillText));
                        const result = await uploadAiSkillVersion(credentials, selected.id, [{ path: 'SKILL.md', contentBase64: markdown }, ...files.filter((file) => file.path !== 'SKILL.md')]);
                        setUploadedVersion(result.version);
                        await refreshSelected();
                        setPreview(await fetchAiSkillVersion(credentials, selected.id, result.version));
                    })}><Ionicons name="cloud-upload-outline" size={17} color={theme.colors.button.primary.tint} /><Text style={[styles.actionText, styles.primaryText]}>{isZh ? '上传版本' : 'Upload version'}</Text></Pressable>
                    {uploadedVersion ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        const confirmed = await Modal.confirm(isZh ? '发布此版本？' : 'Publish this version?', `${selected.name} · v${uploadedVersion}`, { confirmText: isZh ? '发布' : 'Publish' });
                        if (!confirmed) return;
                        await publishAiSkillVersion(credentials, selected.id, uploadedVersion);
                        await Promise.all([refresh(), refreshSelected()]);
                        setPreview(await fetchAiSkillVersion(credentials, selected.id, uploadedVersion));
                    })}><Ionicons name="checkmark-circle-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? `发布 v${uploadedVersion}` : `Publish v${uploadedVersion}`}</Text></Pressable> : null}
                </View>
                {selected.currentVersion && detail ? <>
                    <Text style={styles.heading}>{isZh ? '绑定 Agent' : 'Bind agent'}</Text>
                    {data.agents.filter((agent) => !detail.teamId || agent.teamIds.includes(detail.teamId)).map((agent) => {
                        const bound = detail.bindings.some((binding) => binding.agentId === agent.id);
                        return <Pressable key={agent.id} style={styles.row} disabled={busy} onPress={() => perform(async () => {
                            if (!credentials) throw new Error('Authentication is required');
                            if (bound) {
                                if (!await Modal.confirm(isZh ? '解除绑定？' : 'Remove binding?', agent.name)) return;
                                await unbindAiSkillAgent(credentials, selected.id, agent.id);
                            } else await bindAiSkillAgent(credentials, selected.id, agent.id);
                            await refreshSelected();
                        })}><Text style={[styles.rowTitle, styles.rowBody]}>{agent.name}</Text><Text style={styles.rowMeta}>{bound ? `${isZh ? '已绑定 · 当前发布' : 'Bound · current published'} v${detail.currentVersion}` : (isZh ? '未绑定' : 'Not bound')}</Text><Ionicons name={bound ? 'unlink-outline' : 'link-outline'} size={17} color={theme.colors.textSecondary} /></Pressable>;
                    })}
                    <Text style={styles.heading}>{isZh ? '经验提议' : 'Learning proposal'}</Text>
                    <TextInput style={[styles.field, { minHeight: 80 }]} multiline value={proposal} onChangeText={setProposal} placeholder={isZh ? '待人工审查的建议' : 'Suggestion for review'} placeholderTextColor={theme.colors.textSecondary} />
                    <View style={styles.actions}><Pressable style={styles.action} disabled={busy || !proposal.trim()} onPress={() => perform(async () => {
                        if (!credentials) throw new Error('Authentication is required');
                        const text = proposal.trim();
                        await proposeAiSkillLearning(credentials, selected.id, text);
                        await refreshSelected();
                        setProposal(''); Modal.alert(isZh ? '已提交审查' : 'Submitted for review');
                    })}><Ionicons name="send-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '提交提议' : 'Submit proposal'}</Text></Pressable></View>
                    {proposals.map((item) => <View key={item.id} style={styles.section}>
                        <Text style={styles.rowMeta}>{item.status}</Text>
                        <Text selectable style={styles.note}>{item.text}</Text>
                        {item.status === 'pending' ? <View style={styles.actions}>{(['accepted', 'rejected'] as const).map((decision) => <Pressable key={decision} style={styles.action} disabled={busy} onPress={() => perform(async () => {
                            if (!credentials) throw new Error('Authentication is required');
                            const confirmed = await Modal.confirm(isZh ? '确认审查结果？' : 'Confirm review?', item.text, {
                                confirmText: decision === 'accepted' ? (isZh ? '接受' : 'Accept') : (isZh ? '驳回' : 'Reject'),
                            });
                            if (!confirmed) return;
                            await reviewAiSkillProposal(credentials, selected.id, item.id, decision);
                            await refreshSelected();
                        })}><Ionicons name={decision === 'accepted' ? 'checkmark-outline' : 'close-outline'} size={17} color={theme.colors.text} /><Text style={styles.actionText}>{decision === 'accepted' ? (isZh ? '接受' : 'Accept') : (isZh ? '驳回' : 'Reject')}</Text></Pressable>)}</View>
                            : null}
                    </View>)}
                </> : null}
            </View> : null}
            {error ? <Text style={{ color: theme.colors.textDestructive }}>{error}</Text> : null}
        </ScrollView>
    </View>;
}
