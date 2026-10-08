import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { useAuth } from '@/auth/AuthContext';
import { useManagedAiTeamData, refreshManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { getCurrentLanguage } from '@/text';
import { Modal } from '@/modal';
import { applyAiAgentTemplate, createAiAgentTemplate, createAiAgentTemplateVersion,
    fetchAiAgentTemplate, fetchAiAgentTemplates, fetchAiAgentTemplateVersion,
    fetchAiAgentTemplateProposals, reviewAiAgentTemplateProposal, type AiAgentTemplateProposal,
    publishAiAgentTemplate, rollbackAiAgentTemplate, type AiAgentTemplateContent,
    type AiAgentTemplateDetail, type AiAgentTemplateSummary, type AiAgentTemplateVersion } from '@/sync/apiAiTeams';

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 20, paddingBottom: 64, gap: 24 },
    section: { gap: 10 },
    heading: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text, fontSize: 14 },
    muted: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    error: { color: theme.colors.textDestructive, fontSize: 13 },
    input: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, color: theme.colors.text },
    row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: 4 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
    selected: { backgroundColor: theme.colors.surfaceHigh },
    actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));

const emptyContent: AiAgentTemplateContent = { role: '', description: '', emoji: '',
    skills: [], responsibilities: [], instructions: '' };

export default function AiAgentTemplatesPage() {
    const { credentials } = useAuth();
    const { theme } = useUnistyles();
    const isZh = getCurrentLanguage().startsWith('zh');
    const agents = useManagedAiTeamData().agents;
    const [items, setItems] = React.useState<AiAgentTemplateSummary[]>([]);
    const [selectedId, setSelectedId] = React.useState('');
    const [detail, setDetail] = React.useState<AiAgentTemplateDetail | null>(null);
    const [version, setVersion] = React.useState<AiAgentTemplateVersion | null>(null);
    const [proposals, setProposals] = React.useState<AiAgentTemplateProposal[]>([]);
    const [currentPublished, setCurrentPublished] = React.useState<AiAgentTemplateVersion | null>(null);
    const [name, setName] = React.useState('');
    const [role, setRole] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [emoji, setEmoji] = React.useState('');
    const [skills, setSkills] = React.useState('');
    const [responsibilities, setResponsibilities] = React.useState('');
    const [instructions, setInstructions] = React.useState('');
    const [targetAgentId, setTargetAgentId] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const selectionRequest = React.useRef(0);
    const activeSecret = React.useRef(credentials?.secret);
    activeSecret.current = credentials?.secret;
    const setForm = (content: AiAgentTemplateContent) => {
        setRole(content.role); setDescription(content.description); setEmoji(content.emoji);
        setSkills(content.skills.join('\n')); setResponsibilities(content.responsibilities.join('\n'));
        setInstructions(content.instructions);
    };
    const formContent = (): AiAgentTemplateContent => ({ role: role.trim(), description: description.trim(),
        emoji: emoji.trim(), skills: skills.split('\n').map((item) => item.trim()).filter(Boolean),
        responsibilities: responsibilities.split('\n').map((item) => item.trim()).filter(Boolean), instructions });
    const loadList = React.useCallback(async () => {
        if (!credentials) return;
        const result = await fetchAiAgentTemplates(credentials);
        if (credentials.secret === activeSecret.current) setItems(result.items);
    }, [credentials?.secret]);
    React.useEffect(() => {
        let active = true;
        selectionRequest.current++;
        setItems([]); setSelectedId(''); setDetail(null); setVersion(null); setProposals([]); setCurrentPublished(null); setForm(emptyContent); setName('');
        if (credentials) fetchAiAgentTemplates(credentials).then((result) => {
            if (active) setItems(result.items);
        }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
        return () => { active = false; };
    }, [credentials?.secret]);
    const selectTemplate = async (id: string, requestedVersion?: number) => {
        if (!credentials) return;
        const secret = credentials.secret;
        const requestId = ++selectionRequest.current;
        setSelectedId(id); setDetail(null); setVersion(null); setProposals([]); setCurrentPublished(null); setError(null);
        const next = await fetchAiAgentTemplate(credentials, id);
        const number = requestedVersion ?? next.currentVersion ?? next.versions[0]?.version;
        const selected = number ? await fetchAiAgentTemplateVersion(credentials, id, number) : null;
        const [proposalResult, published] = await Promise.all([
            fetchAiAgentTemplateProposals(credentials, id),
            next.currentVersion ? fetchAiAgentTemplateVersion(credentials, id, next.currentVersion) : Promise.resolve(null),
        ]);
        if (requestId !== selectionRequest.current || secret !== activeSecret.current) return;
        setDetail(next); setVersion(selected); setProposals(proposalResult.items); setCurrentPublished(published); setName(next.name);
        if (selected) setForm(selected.content);
    };
    const perform = async (action: () => Promise<void>) => {
        if (busy) return;
        setBusy(true); setError(null);
        try { await action(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    const createDraft = () => perform(async () => {
        if (!credentials) return;
        const content = formContent();
        if (!name.trim() || !content.description) throw new Error(isZh ? '请填写名称和描述' : 'Name and description are required');
        if (selectedId) {
            const created = await createAiAgentTemplateVersion(credentials, selectedId, content);
            await selectTemplate(selectedId, created.version);
        } else {
            const created = await createAiAgentTemplate(credentials, name.trim(), content);
            await selectTemplate(created.id, created.version);
        }
        await loadList();
    });
    const latest = detail?.versions[0]?.version;
    const canPublish = version && !version.publishedAt && version.version === latest;
    const canRollback = version?.publishedAt && !version.current;
    const canApply = version?.current && version.publishedAt && !!targetAgentId;
    const form = formContent();
    const saved = version?.content ?? emptyContent;
    const hasUnsavedChanges = form.role !== saved.role || form.description !== saved.description
        || form.emoji !== saved.emoji || form.instructions !== saved.instructions
        || form.skills.length !== saved.skills.length || form.skills.some((value, index) => value !== saved.skills[index])
        || form.responsibilities.length !== saved.responsibilities.length
        || form.responsibilities.some((value, index) => value !== saved.responsibilities[index])
        || (!selectedId && !!name.trim());
    const confirmDiscard = async () => !hasUnsavedChanges || Modal.confirm(
        isZh ? '放弃未保存的草稿？' : 'Discard unsaved draft?',
        isZh ? '切换模板或版本会丢失当前输入。' : 'Changing template or version will discard your input.');

    return <View style={styles.screen}>
        <Stack.Screen options={{ headerTitle: isZh ? 'Agent 模板' : 'Agent templates' }} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '模板' : 'Templates'}</Text>
                <View style={styles.actions}><Pressable style={[styles.action, !selectedId && styles.selected]} onPress={async () => {
                    if (!await confirmDiscard()) return;
                    selectionRequest.current++; setSelectedId(''); setDetail(null); setVersion(null); setProposals([]); setCurrentPublished(null); setName(''); setForm(emptyContent);
                }}><Ionicons name="add-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '新模板' : 'New template'}</Text></Pressable></View>
                {items.map((item) => <Pressable key={item.id} style={[styles.row, selectedId === item.id && styles.selected]}
                    onPress={() => perform(async () => { if (await confirmDiscard()) await selectTemplate(item.id); })}>
                    <Text style={styles.text}>{item.name}</Text>
                    <Text style={styles.muted}>{item.currentVersion ? `v${item.currentVersion}` : (isZh ? '未发布' : 'Unpublished')} · {item.versions.length} {isZh ? '个版本' : 'versions'}</Text>
                </Pressable>)}
            </View>
            {detail ? <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '版本历史' : 'Versions'}</Text>
                <View style={styles.actions}>{detail.versions.map((item) => <Pressable key={item.version}
                    style={[styles.action, version?.version === item.version && styles.selected]}
                    onPress={() => perform(async () => { if (await confirmDiscard()) await selectTemplate(detail.id, item.version); })}>
                    <Text style={styles.actionText}>v{item.version}{item.version === detail.currentVersion ? ' · current' : ''}</Text>
                </Pressable>)}</View>
                {version ? <>
                    <Text style={styles.muted} selectable>SHA-256: {version.contentHash}</Text>
                    <Text style={styles.muted}>{version.publishedAt ? (isZh ? '已发布' : 'Published') : (isZh ? '草稿' : 'Draft')} · {new Date(version.createdAt).toLocaleString()}</Text>
                    <Text style={styles.text}>{version.content.role} · {version.content.description}</Text>
                    <Text style={styles.text}>{version.content.instructions}</Text>
                    <Text style={styles.muted}>{version.content.skills.join(', ')} · {version.content.responsibilities.join(', ')}</Text>
                    {canPublish ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials || !await Modal.confirm(isZh ? '发布这个版本？' : 'Publish this version?', `v${version.version}\n${version.contentHash}`)) return;
                        await publishAiAgentTemplate(credentials, selectedId, version.version);
                        await selectTemplate(selectedId, version.version); await loadList();
                    })}><Ionicons name="cloud-upload-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '确认发布' : 'Publish'}</Text></Pressable> : null}
                    {canRollback ? <Pressable style={styles.action} disabled={busy} onPress={() => perform(async () => {
                        if (!credentials || !await Modal.confirm(isZh ? '回滚到这个版本？' : 'Roll back to this version?', `v${version.version}\n${version.contentHash}`)) return;
                        await rollbackAiAgentTemplate(credentials, selectedId, version.version);
                        await selectTemplate(selectedId, version.version); await loadList();
                    })}><Ionicons name="return-down-back-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '确认回滚' : 'Roll back'}</Text></Pressable> : null}
                </> : null}
            </View> : null}
            {detail ? <View style={styles.section}>
                <View style={styles.actions}>
                    <Text style={styles.heading}>{isZh ? '经验提议审查' : 'Template proposals'} · {proposals.length}</Text>
                    <Pressable accessibilityLabel={isZh ? '刷新提议' : 'Refresh proposals'} disabled={busy}
                        onPress={() => perform(() => selectTemplate(detail.id, version?.version))}>
                        <Ionicons name="refresh-outline" size={17} color={theme.colors.text} />
                    </Pressable>
                </View>
                {proposals.map((proposal) => <View key={proposal.id} style={styles.row}>
                    <Text style={styles.text}>{proposal.status} · {new Date(proposal.createdAt).toLocaleString()}</Text>
                    <Text style={styles.muted} selectable>{proposal.sourceExecutionId
                        ? (isZh ? '受信执行来源' : 'Execution source') + `: ${proposal.sourceExecutionId}`
                        : (isZh ? '用户提交；不能证明 Agent 自主上报' : 'User submitted; not proof of agent action')}</Text>
                    {proposal.sourceAgentId ? <Text style={styles.muted} selectable>Agent: {agents.find((agent) => agent.id === proposal.sourceAgentId)?.name ?? proposal.sourceAgentId}</Text> : null}
                    <Text style={styles.muted} selectable>{isZh ? '提议内容哈希' : 'Proposal hash'} SHA-256: {proposal.contentHash}</Text>
                    <Text style={styles.muted}>{isZh ? '提交时当前发布版' : 'Published baseline'}: v{proposal.expectedCurrentVersion}</Text>
                    {proposal.frozenVersion && proposal.frozenContentHash && proposal.frozenContent ? <>
                        <Text style={styles.muted} selectable>{isZh ? '执行冻结版' : 'Execution snapshot'}: v{proposal.frozenVersion} · SHA-256: {proposal.frozenContentHash}</Text>
                        <Text style={styles.text} selectable>{JSON.stringify(proposal.frozenContent, null, 2)}</Text>
                    </> : null}
                    <Text style={styles.text} selectable>{JSON.stringify(proposal.content, null, 2)}</Text>
                    {proposal.note ? <Text style={styles.muted} selectable>{proposal.note}</Text> : null}
                    {currentPublished ? <>
                        <Text style={styles.muted} selectable>{isZh ? '现在发布版' : 'Current published version'}: v{currentPublished.version} · SHA-256: {currentPublished.contentHash}</Text>
                        <Text style={styles.text} selectable>{JSON.stringify(currentPublished.content, null, 2)}</Text>
                    </> : null}
                    {proposal.status === 'pending' ? <View style={styles.actions}>{(['accepted', 'rejected'] as const).map((decision) =>
                        <Pressable key={decision} style={styles.action} disabled={busy || detail.currentVersion !== proposal.expectedCurrentVersion}
                            onPress={() => perform(async () => {
                                if (!credentials || !await Modal.confirm(
                                    decision === 'accepted' ? (isZh ? '接受并发布提议？' : 'Accept and publish proposal?') : (isZh ? '拒绝提议？' : 'Reject proposal?'),
                                    `${proposal.id}\nv${proposal.expectedCurrentVersion}\nSHA-256: ${proposal.contentHash}`)) return;
                                await reviewAiAgentTemplateProposal(credentials, detail.id, proposal.id, decision, proposal.expectedCurrentVersion);
                                await selectTemplate(detail.id, version?.version);
                                await loadList();
                            })}>
                            <Ionicons name={decision === 'accepted' ? 'checkmark-outline' : 'close-outline'} size={17} color={theme.colors.text} />
                            <Text style={styles.actionText}>{decision === 'accepted' ? (isZh ? '接受并发布' : 'Accept and publish') : (isZh ? '拒绝' : 'Reject')}</Text>
                        </Pressable>)}</View> : null}
                    {proposal.status === 'pending' && detail.currentVersion !== proposal.expectedCurrentVersion
                        ? <Text style={styles.error}>{isZh ? '发布版已变化；请刷新并重新审查，旧提议无法直接通过。' : 'Published version changed. Refresh and review; this proposal cannot be approved.'}</Text> : null}
                    {proposal.reviewedAt ? <Text style={styles.muted}>{new Date(proposal.reviewedAt).toLocaleString()}{proposal.publishedVersion ? ` · v${proposal.publishedVersion}` : ''}</Text> : null}
                </View>)}
            </View> : null}
            <View style={styles.section}>
                <Text style={styles.heading}>{selectedId ? (isZh ? '新建不可变草稿版本' : 'New immutable draft version') : (isZh ? '新建模板草稿' : 'New template draft')}</Text>
                {!selectedId ? <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={isZh ? '模板名称' : 'Template name'} placeholderTextColor={theme.colors.textSecondary} /> : null}
                <TextInput style={styles.input} value={role} onChangeText={setRole} placeholder={isZh ? '角色' : 'Role'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder={isZh ? '描述' : 'Description'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={styles.input} value={emoji} onChangeText={setEmoji} placeholder={isZh ? '图标字符' : 'Icon character'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]} multiline value={skills} onChangeText={setSkills} placeholder={isZh ? '技能，每行一项' : 'Skills, one per line'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]} multiline value={responsibilities} onChangeText={setResponsibilities} placeholder={isZh ? '职责，每行一项' : 'Responsibilities, one per line'} placeholderTextColor={theme.colors.textSecondary} />
                <TextInput style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline value={instructions} onChangeText={setInstructions} placeholder={isZh ? '指令' : 'Instructions'} placeholderTextColor={theme.colors.textSecondary} />
                <Pressable style={styles.action} disabled={busy || !description.trim() || (!selectedId && !name.trim())} onPress={createDraft}>
                    <Ionicons name="save-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '保存草稿' : 'Save draft'}</Text>
                </Pressable>
            </View>
            {detail?.currentVersion ? <View style={styles.section}>
                <Text style={styles.heading}>{isZh ? '应用到 Agent' : 'Apply to agent'}</Text>
                <View style={styles.actions}>{agents.map((agent) => <Pressable key={agent.id}
                    style={[styles.action, targetAgentId === agent.id && styles.selected]} onPress={() => setTargetAgentId(agent.id)}>
                    <Text style={styles.actionText}>{agent.name}</Text></Pressable>)}</View>
                <Pressable style={styles.action} disabled={busy || !canApply} onPress={() => perform(async () => {
                    if (!credentials || !version || !targetAgentId || !await Modal.confirm(
                        isZh ? '应用当前已发布版本？' : 'Apply current published version?',
                        `${agents.find((agent) => agent.id === targetAgentId)?.name} · v${version.version}\n${isZh ? '只更新内容；运行时、模型、目录和权限保持原值。' : 'Only content changes; runtime, model, directory and permissions stay as set.'}`)) return;
                    await applyAiAgentTemplate(credentials, targetAgentId, selectedId, version.version);
                    await refreshManagedAiTeamData(credentials);
                })}><Ionicons name="checkmark-outline" size={17} color={theme.colors.text} /><Text style={styles.actionText}>{isZh ? '确认应用' : 'Apply'}</Text></Pressable>
            </View> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
    </View>;
}
