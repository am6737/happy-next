import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { putTeammateSeed } from '@/sync/teammateDraft';
import { TEAMMATE_TEMPLATES, type TeammateTemplate } from '@/sync/teammateTemplates';
import { useTeammateInterview } from '@/hooks/useTeammateInterview';
import { isMachineOnline } from '@/utils/machineUtils';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { TeammateAvatar } from './ui';
import { MachinePicker } from './TeammateFormFields';
import { TeammateSheet, useTeammateSheet } from './TeammateSheet';
import { KIT_PAGE_PADDING, PillButton, SectionLabel, StatusDot } from './kit';

function templateText(template: TeammateTemplate, key: 'title' | 'description' | 'prompt' | 'name' | 'role'): string {
    return t(`teammates.createFlow.templates.${template.id}.${key}`);
}

/**
 * Start of Agent creation. Describing the Agent (or tapping a template) starts an AI interview on an online
 * machine: the draft stays pinned at the top with fields from the latest round highlighted, and questions come
 * one at a time. "Next" hands the draft to the confirm form. Without an online machine templates prefill the
 * confirm form directly, and "start from scratch" always opens it blank.
 */
export function TeammateCreateStart() {
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    const machines = useAllMachines();
    const online = React.useMemo(() => machines.filter(isMachineOnline), [machines]);
    const [pickedMachineId, setMachineId] = React.useState('');
    // Falls back to the first online machine when the picked one goes offline.
    const machineId = online.some(machine => machine.id === pickedMachineId) ? pickedMachineId : online[0]?.id ?? '';
    const machine = online.find(item => item.id === machineId);
    const interview = useTeammateInterview();
    const { draft, question } = interview;
    const [description, setDescription] = React.useState('');
    const [reply, setReply] = React.useState('');
    const [showInstructions, setShowInstructions] = React.useState(false);
    const machineSheet = useTeammateSheet();
    const scroll = React.useRef<ScrollView>(null);
    const allowExit = React.useRef(false);

    // Leaving mid-interview throws the draft away, so ask first.
    React.useEffect(() => navigation.addListener('beforeRemove', event => {
        if (allowExit.current || !interview.started) return;
        event.preventDefault();
        Modal.confirm(t('artifacts.discardChanges'), t('artifacts.discardChangesDescription'), { confirmText: t('common.discard'), destructive: true })
            .then(confirmed => {
                if (!confirmed) return;
                allowExit.current = true;
                navigation.dispatch(event.data.action);
            });
    }), [navigation, interview.started]);

    // Opening the confirm form keeps this screen below it; creating the Agent then removes both without asking.
    useFocusEffect(React.useCallback(() => { allowExit.current = false; }, []));
    const openConfirm = (seed?: string) => {
        allowExit.current = true;
        router.push(seed ? { pathname: '/teammates/new/confirm', params: { seed } } : '/teammates/new/confirm');
    };

    React.useEffect(() => {
        if (interview.started) setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }, [interview.started, interview.messages.length, interview.loading, interview.questionIndex]);

    const start = (text: string) => {
        if (!machineId || !text.trim()) return;
        setDescription(text);
        interview.start(machineId, text);
    };

    const pickTemplate = (template: TeammateTemplate) => {
        if (machineId) {
            start(templateText(template, 'prompt'));
            return;
        }
        const seed = putTeammateSeed({
            machineId: '',
            draft: { name: templateText(template, 'name'), handle: template.handle, role: templateText(template, 'role'), skills: [], instructions: '' },
        });
        openConfirm(seed);
    };

    const send = () => {
        const text = reply.trim();
        if (!text) return;
        if (question) interview.reply(text); else interview.sendFeedback(text);
        setReply('');
    };

    const next = () => {
        if (!draft) return;
        openConfirm(putTeammateSeed({ draft, machineId: interview.machineId }));
    };

    const startOver = () => {
        interview.startOver();
        setReply('');
        setShowInstructions(false);
    };

    const highlight = (field: 'name' | 'role') => interview.changed.includes(field) && styles.highlight;
    const Container = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

    if (!interview.started) {
        const canSend = !!machineId && !!description.trim();
        return (
            <View style={styles.page}>
                <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
                    contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
                    <Text style={styles.title}>{t('teammates.createFlow.title')}</Text>

                    <View style={styles.compose}>
                        <TextInput
                            accessibilityLabel={t('teammates.ai.describeTitle')}
                            value={description}
                            onChangeText={setDescription}
                            placeholder={t('teammates.ai.placeholder')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            multiline
                            textAlignVertical="top"
                            style={[styles.composeInput, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0 } as any]}
                        />
                        <View style={styles.composeBar}>
                            {machine ? (
                                <Pressable accessibilityRole="button" accessibilityLabel={t('teammates.ai.runOn')} hitSlop={8} onPress={machineSheet.present} style={styles.machineChip}>
                                    <StatusDot color={theme.colors.status.connected} />
                                    <Text style={styles.machineText} numberOfLines={1}>{machine.metadata?.displayName || machine.metadata?.host || machine.id}</Text>
                                    <Ionicons name="chevron-down" size={14} color={theme.colors.textSecondary} />
                                </Pressable>
                            ) : (
                                <View style={styles.machineChip}>
                                    <StatusDot color={theme.colors.textSecondary} />
                                    <Text style={styles.machineText}>{t('teammates.createFlow.noMachine')}</Text>
                                </View>
                            )}
                            <Pressable accessibilityRole="button" accessibilityLabel={t('teammates.ai.start')} accessibilityState={{ disabled: !canSend }}
                                disabled={!canSend} onPress={() => start(description)} style={[styles.send, !canSend && styles.disabled]}>
                                <Ionicons name="arrow-up" size={18} color={theme.colors.button.primary.tint} />
                            </Pressable>
                        </View>
                    </View>
                    {!machine && <Text style={styles.note}>{t('teammates.createFlow.noMachineHint')}</Text>}

                    <SectionLabel title={t('teammates.createFlow.templatesTitle')} />
                    <View style={styles.templates}>
                        {TEAMMATE_TEMPLATES.map(template => (
                            <Pressable key={template.id} accessibilityRole="button" accessibilityLabel={templateText(template, 'title')} onPress={() => pickTemplate(template)}
                                style={({ pressed }) => [styles.template, pressed && styles.pressed]}>
                                <Text style={styles.templateTitle}>{templateText(template, 'title')}</Text>
                                <Text style={styles.templateDescription}>{templateText(template, 'description')}</Text>
                            </Pressable>
                        ))}
                    </View>

                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => openConfirm()} style={styles.blank}>
                        <Text style={styles.blankText}>{t('teammates.createFlow.blank')}</Text>
                    </Pressable>
                </ScrollView>

                <TeammateSheet ref={machineSheet.ref} title={t('teammates.ai.runOn')}>
                    <MachinePicker machines={online} label="" value={machineId} onChange={id => { setMachineId(id); machineSheet.dismiss(); }} />
                </TeammateSheet>
            </View>
        );
    }

    return (
        <Container behavior="padding" keyboardVerticalOffset={0} style={styles.page}>
            <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                {draft && (
                    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showInstructions }} onPress={() => setShowInstructions(value => !value)}
                        style={styles.pin}>
                        <View style={styles.pinHeader}>
                            <TeammateAvatar teammate={{ name: draft.name, avatar: draft.avatar ?? null }} size={44} />
                            <View style={styles.pinText}>
                                <Text style={styles.pinName} numberOfLines={1}><Text style={highlight('name')}>{draft.name || t('teammates.unnamed')}</Text></Text>
                                <Text style={styles.pinRole} numberOfLines={showInstructions ? undefined : 2}>
                                    <Text style={highlight('role')}>{draft.role || t('teammates.noRole')}</Text>
                                </Text>
                            </View>
                            <Ionicons name={showInstructions ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textSecondary} />
                        </View>
                        {showInstructions && !!draft.instructions && (
                            <Text style={[styles.pinInstructions, interview.changed.includes('instructions') && styles.highlight]}>{draft.instructions}</Text>
                        )}
                    </Pressable>
                )}

                {interview.messages.map((message, index) => message.from === 'me'
                    ? <Text key={index} style={styles.me}>{message.text}</Text>
                    : <Text key={index} style={styles.ai}>{message.text}</Text>)}

                {interview.loading && (
                    <View style={styles.status}>
                        <ActivityIndicator color={theme.colors.textSecondary} />
                        <View style={styles.statusText}>
                            <Text style={styles.statusTitle}>{t('teammates.ai.drafting')}</Text>
                            <Text style={styles.statusHint}>{t('teammates.ai.draftingHint')}</Text>
                        </View>
                    </View>
                )}

                {interview.error && !interview.loading && (
                    <View style={styles.errorBlock}>
                        <Text accessibilityRole="alert" style={styles.error}>{interview.error}</Text>
                        <Pressable accessibilityRole="button" hitSlop={8} onPress={interview.retry}>
                            <Text style={styles.link}>{t('common.retry')}</Text>
                        </Pressable>
                    </View>
                )}

                {question && (
                    <>
                        {interview.questionIndex === 0 && <Text style={styles.ai}>{t('teammates.createFlow.draftReady')}</Text>}
                        <View style={styles.question}>
                            <Text style={styles.questionCount}>{`${interview.questionIndex + 1} / ${interview.questionCount}`}</Text>
                            <Text style={styles.questionText}>{question.question}</Text>
                            {question.suggestions.length > 0 && (
                                <View style={styles.suggestions}>
                                    {question.suggestions.map(suggestion => (
                                        <Pressable key={suggestion} accessibilityRole="button" accessibilityLabel={suggestion} onPress={() => interview.reply(suggestion)}
                                            style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}>
                                            <Text style={styles.suggestionText}>{suggestion}</Text>
                                        </Pressable>
                                    ))}
                                </View>
                            )}
                            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => interview.reply(undefined)} style={styles.skip}>
                                <Text style={styles.note}>{t('teammates.createFlow.skip')}</Text>
                            </Pressable>
                        </View>
                    </>
                )}

                {draft && !question && !interview.loading && !interview.error && <Text style={styles.ai}>{t('teammates.ai.ready')}</Text>}

                {!interview.loading && (
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={startOver} style={styles.blank}>
                        <Text style={styles.blankText}>{t('teammates.ai.startOver')}</Text>
                    </Pressable>
                )}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
                {draft && (
                    <View style={styles.replyBar}>
                        <TextInput
                            accessibilityLabel={question ? t('teammates.ai.answerPlaceholder') : t('teammates.createFlow.replyPlaceholder')}
                            value={reply}
                            onChangeText={setReply}
                            onSubmitEditing={send}
                            editable={!interview.loading}
                            placeholder={question ? t('teammates.ai.answerPlaceholder') : t('teammates.createFlow.replyPlaceholder')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            returnKeyType="send"
                            style={[styles.replyInput, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0 } as any]}
                        />
                        {!!reply.trim() && (
                            <Pressable accessibilityRole="button" accessibilityLabel={t('teammates.ai.continue')} disabled={interview.loading} onPress={send} style={styles.replySend}>
                                <Ionicons name="arrow-up" size={16} color={theme.colors.button.primary.tint} />
                            </Pressable>
                        )}
                    </View>
                )}
                <PillButton label={t('teammates.createFlow.next')} onPress={next} disabled={!draft || interview.loading} />
            </View>
        </Container>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 16,
        paddingBottom: 32,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 28,
        color: theme.colors.text,
        marginTop: 8,
    },
    compose: {
        marginTop: 20,
        padding: 18,
        borderRadius: 20,
        backgroundColor: theme.colors.surfaceHigh,
    },
    composeInput: {
        ...Typography.default(),
        minHeight: 100,
        padding: 0,
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
    },
    composeBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingTop: 12,
    },
    machineChip: {
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    machineText: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    send: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    disabled: {
        opacity: 0.3,
    },
    pressed: {
        opacity: 0.7,
    },
    note: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        marginTop: 10,
        paddingHorizontal: 4,
    },
    templates: {
        gap: 10,
    },
    template: {
        gap: 4,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceHigh,
    },
    templateTitle: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    templateDescription: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    blank: {
        alignSelf: 'center',
        marginTop: 28,
        paddingVertical: 4,
    },
    blankText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    pin: {
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceHigh,
    },
    pinHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    pinText: {
        flex: 1,
        gap: 2,
    },
    pinName: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text,
    },
    pinRole: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    pinInstructions: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 21,
        color: theme.colors.text,
    },
    highlight: {
        backgroundColor: theme.colors.box.warning.background,
        color: theme.colors.text,
    },
    me: {
        ...Typography.default(),
        alignSelf: 'flex-end',
        maxWidth: '85%',
        marginTop: 24,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 18,
        overflow: 'hidden',
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.button.primary.tint,
        backgroundColor: theme.colors.button.primary.background,
    },
    ai: {
        ...Typography.default(),
        marginTop: 24,
        fontSize: 15,
        lineHeight: 23,
        color: theme.colors.text,
    },
    errorBlock: {
        marginTop: 24,
    },
    error: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.textDestructive,
    },
    link: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        marginTop: 8,
        color: theme.colors.textLink,
    },
    status: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        marginTop: 24,
    },
    statusText: {
        flex: 1,
        gap: 4,
    },
    statusTitle: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    statusHint: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    question: {
        marginTop: 16,
        padding: 18,
        borderRadius: 18,
        backgroundColor: theme.colors.surfaceHigh,
    },
    questionCount: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    questionText: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        lineHeight: 24,
        marginTop: 8,
        color: theme.colors.text,
    },
    suggestions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 14,
    },
    suggestion: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
    },
    suggestionPressed: {
        backgroundColor: theme.colors.button.primary.background,
    },
    suggestionText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    skip: {
        alignSelf: 'flex-start',
        marginLeft: -4,
    },
    footer: {
        gap: 10,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 10,
        backgroundColor: theme.colors.surface,
    },
    replyBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 46,
        paddingLeft: 18,
        paddingRight: 6,
        borderRadius: 23,
        backgroundColor: theme.colors.surfaceHigh,
    },
    replyInput: {
        ...Typography.default(),
        flex: 1,
        paddingVertical: 10,
        fontSize: 14,
        color: theme.colors.text,
    },
    replySend: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
}));
