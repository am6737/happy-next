import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { AiIdentityAvatar } from './components';
import type { AiAgentDraft } from './agentDefinition';
import type { AiAgentEngine, AiAgentPermissionMode, AiAgentVisibility } from './mockData';
import { Modal } from '@/modal';

const stylesheet = StyleSheet.create((theme) => ({
    section: { marginBottom: { xs: 28, md: 38 } },
    sectionTitle: { color: theme.colors.text, fontSize: { xs: 19, md: 21 }, fontWeight: '700', marginBottom: { xs: 14, md: 16 } },
    card: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: { xs: 17, md: 22 }, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    field: { paddingHorizontal: { xs: 18, md: 26 }, paddingVertical: { xs: 19, md: 24 } },
    fieldDivider: { borderTopWidth: 1, borderTopColor: theme.colors.divider },
    label: { color: theme.colors.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
    input: { minHeight: 52, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 13, paddingHorizontal: 16, color: theme.colors.input.text, backgroundColor: theme.colors.surface, fontSize: 16 },
    textArea: { minHeight: 112, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top' },
    instructions: { minHeight: { xs: 160, md: 190 }, paddingTop: 16, paddingBottom: 16, textAlignVertical: 'top', fontSize: 16, lineHeight: 24 },
    avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    avatarButton: { alignItems: 'center', gap: 9 },
    avatarHint: { color: theme.colors.textSecondary, fontSize: 13 },
    select: { minHeight: 64, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 14, paddingHorizontal: { xs: 14, md: 17 }, flexDirection: 'row', alignItems: 'center', gap: 13 },
    selectPressed: { backgroundColor: theme.colors.surfaceHigh },
    selectIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
    selectText: { flex: 1 },
    selectValue: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    accessCard: { padding: { xs: 10, md: 14 } },
    accessOption: { paddingHorizontal: { xs: 13, md: 16 }, paddingVertical: 17, flexDirection: 'row', alignItems: 'flex-start', gap: 13, borderRadius: 14 },
    accessSelected: { backgroundColor: theme.colors.surfaceHigh },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.colors.groupped.chevron, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    radioSelected: { borderColor: theme.colors.text },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.text },
    accessText: { flex: 1 },
    accessTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
}));

export function AgentDefinitionForm({
    draft,
    onChange,
    isZh,
    avatarId,
}: {
    draft: AiAgentDraft;
    onChange: (draft: AiAgentDraft) => void;
    isZh: boolean;
    avatarId: string;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const engineLabels: Record<AiAgentEngine, string> = {
        'claude-code': 'Claude Code',
        codex: 'Codex',
        gemini: 'Gemini',
    };
    const safetyLabels: Record<AiAgentPermissionMode, string> = isZh
        ? { read_only: '只读', approval: '操作前确认', guarded_auto: '受控自动执行' }
        : { read_only: 'Read only', approval: 'Ask before actions', guarded_auto: 'Guarded autonomy' };

    const choose = <T extends string>(title: string, options: Array<{ value: T; label: string }>, apply: (value: T) => void) => {
        Modal.alert(title, undefined, [
            ...options.map((option) => ({ text: option.label, onPress: () => apply(option.value) })),
            { text: isZh ? '取消' : 'Cancel', style: 'cancel' as const },
        ]);
    };

    const changeAvatar = async () => {
        const value = await Modal.prompt(isZh ? '头像符号' : 'Avatar emoji', undefined, {
            defaultValue: draft.emoji,
            confirmText: isZh ? '确定' : 'Save',
        });
        if (value?.trim()) onChange({ ...draft, emoji: value.trim() });
    };

    const patchSettings = (patch: Partial<AiAgentDraft['settings']>) => onChange({
        ...draft,
        settings: { ...draft.settings, ...patch },
    });

    const setDescription = (description: string) => onChange({
        ...draft,
        description,
        role: description.length > 72 ? `${description.slice(0, 72)}…` : description,
    });

    const visibility = draft.settings.visibility ?? 'private';

    return (
        <>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{isZh ? '身份' : 'Identity'}</Text>
                <View style={styles.card}>
                    <View style={styles.field}>
                        <Text style={styles.label}>{isZh ? '头像' : 'Avatar'}</Text>
                        <View style={styles.avatarRow}>
                            <Pressable style={styles.avatarButton} onPress={changeAvatar}>
                                <AiIdentityAvatar id={avatarId} name={draft.emoji || draft.name || '?'} size={66} />
                                <Text style={styles.avatarHint}>{isZh ? '更换' : 'Change'}</Text>
                            </Pressable>
                        </View>
                    </View>
                    <View style={[styles.field, styles.fieldDivider]}>
                        <Text style={styles.label}>{isZh ? '名称' : 'Name'}</Text>
                        <TextInput
                            value={draft.name}
                            onChangeText={(name) => onChange({ ...draft, name })}
                            placeholder={isZh ? '例如：深度研究助手' : 'e.g. Deep Research Agent'}
                            placeholderTextColor={theme.colors.input.placeholder}
                            style={styles.input}
                            maxLength={80}
                        />
                    </View>
                    <View style={[styles.field, styles.fieldDivider]}>
                        <Text style={styles.label}>{isZh ? '描述' : 'Description'}</Text>
                        <TextInput
                            value={draft.description}
                            onChangeText={setDescription}
                            placeholder={isZh ? '这个 Agent 负责什么？' : 'What does this agent do?'}
                            placeholderTextColor={theme.colors.input.placeholder}
                            style={[styles.input, styles.textArea]}
                            multiline
                            maxLength={255}
                        />
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{isZh ? '行为' : 'Behavior'}</Text>
                <View style={styles.card}>
                    <View style={styles.field}>
                        <Text style={styles.label}>{isZh ? '工作要求' : 'Instructions'}</Text>
                        <TextInput
                            value={draft.settings.instructions}
                            onChangeText={(instructions) => patchSettings({ instructions })}
                            placeholder={isZh ? '写下工作方式、边界和输出要求…' : 'Write how this agent should work, what to focus on, and what to avoid…'}
                            placeholderTextColor={theme.colors.input.placeholder}
                            style={[styles.input, styles.instructions]}
                            multiline
                        />
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{isZh ? '执行' : 'Execution'}</Text>
                <View style={styles.card}>
                    <View style={styles.field}>
                        <Text style={styles.label}>{isZh ? '执行引擎' : 'Engine'}</Text>
                        <Pressable style={({ pressed }) => [styles.select, pressed && styles.selectPressed]} onPress={() => choose<AiAgentEngine>(isZh ? '选择执行引擎' : 'Choose engine', Object.entries(engineLabels).map(([value, label]) => ({ value: value as AiAgentEngine, label })), (engine) => patchSettings({ engine }))}>
                            <View style={styles.selectIcon}><Ionicons name="terminal-outline" size={20} color={theme.colors.textSecondary} /></View>
                            <View style={styles.selectText}>
                                <Text style={styles.selectValue}>{engineLabels[draft.settings.engine]}</Text>
                            </View>
                            <Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    <View style={[styles.field, styles.fieldDivider]}>
                        <Text style={styles.label}>{isZh ? '安全策略' : 'Safety policy'}</Text>
                        <Pressable style={({ pressed }) => [styles.select, pressed && styles.selectPressed]} onPress={() => choose<AiAgentPermissionMode>(isZh ? '选择安全策略' : 'Choose safety policy', Object.entries(safetyLabels).map(([value, label]) => ({ value: value as AiAgentPermissionMode, label })), (permissionMode) => patchSettings({ permissionMode }))}>
                            <View style={styles.selectIcon}><Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.textSecondary} /></View>
                            <View style={styles.selectText}>
                                <Text style={styles.selectValue}>{safetyLabels[draft.settings.permissionMode]}</Text>
                            </View>
                            <Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{isZh ? '访问范围' : 'Access'}</Text>
                <View style={[styles.card, styles.accessCard]}>
                    {([
                        { value: 'private' as const, title: isZh ? '仅自己' : 'Only me' },
                        { value: 'workspace' as const, title: isZh ? '整个工作区' : 'Entire workspace' },
                    ]).map((option) => {
                        const selected = visibility === option.value;
                        return (
                            <Pressable key={option.value} style={[styles.accessOption, selected && styles.accessSelected]} onPress={() => patchSettings({ visibility: option.value as AiAgentVisibility })}>
                                <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                                <View style={styles.accessText}>
                                    <Text style={styles.accessTitle}>{option.title}</Text>
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
        </>
    );
}
