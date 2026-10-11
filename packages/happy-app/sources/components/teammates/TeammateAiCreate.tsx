import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import type { TeammateDraft, TeammateDraftAnswer, TeammateDraftQuestion, TeammateDraftRequest } from 'happy-wire';
import { useAllMachines } from '@/sync/storage';
import { generateTeammateDraft, putTeammateSeed, type TeammateDraftRound } from '@/sync/teammateDraft';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { getCurrentLanguage, t } from '@/text';
import { TeammateAvatar, teammateErrorMessage } from './ui';
import { ActionButton, ChoiceChip, FooterBar, MachinePicker, TextField } from './TeammateFormFields';

const CONTENT_MAX_WIDTH = 720;
// Matches the request schema; the oldest answers are dropped first on very long interviews.
const MAX_ANSWERS = 20;
const EXCERPT_LINES = 8;

function DraftPreview({ draft }: { draft: TeammateDraft }) {
    const [expanded, setExpanded] = React.useState(false);
    return (
        <View style={styles.card}>
            <View style={styles.identity}>
                <TeammateAvatar teammate={{ name: draft.name, avatar: draft.avatar ?? null }} size={56} />
                <View style={styles.identityText}>
                    <Text style={styles.draftName} numberOfLines={1}>{draft.name || t('teammates.unnamed')}</Text>
                    <Text style={styles.draftHandle} numberOfLines={1}>@{draft.handle}</Text>
                </View>
            </View>
            {!!draft.role && <Text style={styles.draftRole}>{draft.role}</Text>}
            {draft.skills.length > 0 && (
                <View style={styles.chips}>
                    {draft.skills.map(skill => (
                        <View key={skill} style={styles.chip}>
                            <Text style={styles.chipText} numberOfLines={1}>{skill}</Text>
                        </View>
                    ))}
                </View>
            )}
            {!!draft.instructions && (
                <View style={styles.instructions}>
                    <Text style={styles.instructionsText} numberOfLines={expanded ? undefined : EXCERPT_LINES}>{draft.instructions}</Text>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setExpanded(value => !value)}>
                        <Text style={styles.link}>{expanded ? t('teammates.ai.showLess') : t('teammates.ai.showMore')}</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

function QuestionBlock({ question, index, picked, custom, onPick, onCustom }: {
    question: TeammateDraftQuestion; index: number; picked?: string; custom: string; onPick: (value: string | undefined) => void; onCustom: (value: string) => void;
}) {
    return (
        <View style={styles.question}>
            <Text style={styles.questionText}>{`${index + 1}. ${question.question}`}</Text>
            {question.suggestions.length > 0 && (
                <View style={styles.chips}>
                    {question.suggestions.map(suggestion => (
                        <ChoiceChip
                            key={suggestion}
                            label={suggestion}
                            selected={!custom.trim() && picked === suggestion}
                            onPress={() => { onCustom(''); onPick(picked === suggestion ? undefined : suggestion); }}
                        />
                    ))}
                </View>
            )}
            <TextField
                label={question.question}
                hideLabel
                placeholder={t('teammates.ai.answerPlaceholder')}
                value={custom}
                onChange={onCustom}
            />
        </View>
    );
}

/**
 * Guided creation: the user describes the Agent, Claude on their machine returns a draft plus a few
 * follow-up questions, and each round of answers refines the draft until it goes to the wizard for review.
 * Every round re-sends the whole conversation, so nothing is kept on the machine between rounds.
 */
export function TeammateAiCreate() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const machines = useAllMachines();
    const online = React.useMemo(() => machines.filter(isMachineOnline), [machines]);
    const [machineId, setMachineId] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [round, setRound] = React.useState<TeammateDraftRound | null>(null);
    const [answers, setAnswers] = React.useState<TeammateDraftAnswer[]>([]);
    const [picks, setPicks] = React.useState<Record<number, string | undefined>>({});
    const [customs, setCustoms] = React.useState<Record<number, string>>({});
    const [feedback, setFeedback] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const lastRequest = React.useRef<TeammateDraftRequest | null>(null);
    // Bumped on unmount and "start over" so a late reply cannot overwrite a newer state.
    const generation = React.useRef(0);
    const scroll = React.useRef<ScrollView>(null);

    React.useEffect(() => {
        if (!online.some(machine => machine.id === machineId) && online.length) setMachineId(online[0].id);
    }, [online, machineId]);
    React.useEffect(() => () => { generation.current += 1; }, []);

    const run = async (request: TeammateDraftRequest) => {
        const current = ++generation.current;
        lastRequest.current = request;
        setLoading(true);
        setError(null);
        try {
            const result = await generateTeammateDraft(machineId, request);
            if (current !== generation.current) return;
            setRound(result);
            setAnswers(request.answers ?? []);
            setPicks({});
            setCustoms({});
            setFeedback('');
            scroll.current?.scrollTo({ y: 0, animated: true });
        } catch (error) {
            if (current === generation.current) setError(teammateErrorMessage(error));
        } finally {
            if (current === generation.current) setLoading(false);
        }
    };

    const newAnswers = (round?.questions ?? []).flatMap((question, index) => {
        const answer = customs[index]?.trim() || picks[index];
        return answer ? [{ question: question.question, answer }] : [];
    });
    const canUpdate = !!round && (newAnswers.length > 0 || !!feedback.trim());

    const start = () => {
        void run({ description: description.trim(), locale: getCurrentLanguage() });
    };

    const update = () => {
        if (!round) return;
        void run({
            description: description.trim(),
            answers: [...answers, ...newAnswers].slice(-MAX_ANSWERS),
            previous: round.draft,
            feedback: feedback.trim() || undefined,
            locale: getCurrentLanguage(),
        });
    };

    const review = () => {
        if (!round) return;
        const seed = putTeammateSeed({ draft: round.draft, machineId });
        router.push({ pathname: '/teammates/new/manual', params: { seed } });
    };

    const startOver = () => {
        generation.current += 1;
        lastRequest.current = null;
        setRound(null);
        setAnswers([]);
        setPicks({});
        setCustoms({});
        setFeedback('');
        setLoading(false);
        setError(null);
    };

    const retry = () => {
        if (lastRequest.current) void run(lastRequest.current);
    };

    const questions = round?.questions ?? [];

    return (
        <View style={styles.page}>
            <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                {!round && (
                    <>
                        <View style={styles.intro}>
                            <Text style={styles.title}>{t('teammates.ai.describeTitle')}</Text>
                            <Text style={styles.hint}>{t('teammates.ai.describeHint')}</Text>
                        </View>
                        <View style={styles.card}>
                            <TextField
                                label={t('teammates.ai.describeTitle')}
                                hideLabel
                                placeholder={t('teammates.ai.placeholder')}
                                value={description}
                                onChange={setDescription}
                                editable={!loading}
                                multiline
                            />
                            <Text style={styles.label}>{t('teammates.ai.examples')}</Text>
                            <View style={styles.chips}>
                                {[t('teammates.ai.example1'), t('teammates.ai.example2'), t('teammates.ai.example3')].map(example => (
                                    <ChoiceChip key={example} icon="bulb-outline" label={example} disabled={loading} onPress={() => setDescription(example)} />
                                ))}
                            </View>
                        </View>
                        <View style={styles.card}>
                            {online.length
                                ? <MachinePicker label={t('teammates.ai.runOn')} machines={online} value={machineId} onChange={setMachineId} />
                                : <Text style={styles.warning}>{t('teammates.ai.noMachine')}</Text>}
                        </View>
                    </>
                )}

                {loading && (
                    <View style={[styles.card, styles.loading]}>
                        <ActivityIndicator color={theme.colors.textLink} />
                        <View style={styles.loadingText}>
                            <Text style={styles.loadingTitle}>{t('teammates.ai.drafting')}</Text>
                            <Text style={styles.hint}>{t('teammates.ai.draftingHint')}</Text>
                        </View>
                    </View>
                )}

                {error && (
                    <View style={[styles.card, styles.errorCard]}>
                        <Ionicons name="alert-circle-outline" size={18} color={theme.colors.textDestructive} />
                        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
                        <Pressable accessibilityRole="button" hitSlop={8} onPress={retry}>
                            <Text style={styles.link}>{t('common.retry')}</Text>
                        </Pressable>
                    </View>
                )}

                {round && (
                    <>
                        <DraftPreview key={JSON.stringify(round.draft)} draft={round.draft} />
                        {!loading && (questions.length ? (
                            <View style={styles.card}>
                                <View style={styles.intro}>
                                    <Text style={styles.sectionTitle}>{t('teammates.ai.questionsTitle')}</Text>
                                    <Text style={styles.hint}>{t('teammates.ai.questionsHint')}</Text>
                                </View>
                                {questions.map((question, index) => (
                                    <QuestionBlock
                                        key={question.question}
                                        question={question}
                                        index={index}
                                        picked={picks[index]}
                                        custom={customs[index] ?? ''}
                                        onPick={value => setPicks(current => ({ ...current, [index]: value }))}
                                        onCustom={value => setCustoms(current => ({ ...current, [index]: value }))}
                                    />
                                ))}
                            </View>
                        ) : (
                            <View style={styles.ready}>
                                <Ionicons name="checkmark-circle" size={18} color={theme.colors.status.connected} />
                                <Text style={styles.readyText}>{t('teammates.ai.ready')}</Text>
                            </View>
                        ))}
                        {!loading && (
                            <View style={styles.card}>
                                <TextField
                                    label={t('teammates.ai.feedbackPlaceholder')}
                                    hideLabel
                                    placeholder={t('teammates.ai.feedbackPlaceholder')}
                                    value={feedback}
                                    onChange={setFeedback}
                                    multiline
                                />
                            </View>
                        )}
                        <Pressable accessibilityRole="button" style={styles.startOver} hitSlop={8} onPress={startOver}>
                            <Ionicons name="refresh" size={15} color={theme.colors.textSecondary} />
                            <Text style={styles.startOverText}>{t('teammates.ai.startOver')}</Text>
                        </Pressable>
                    </>
                )}
            </ScrollView>

            <FooterBar>
                {!round ? (
                    <ActionButton label={t('teammates.ai.start')} onPress={start} disabled={!description.trim() || !machineId} loading={loading} />
                ) : questions.length || feedback.trim() ? (
                    <>
                        <ActionButton kind="secondary" label={t('teammates.ai.review')} onPress={review} disabled={loading} />
                        <ActionButton label={t('teammates.ai.continue')} onPress={update} disabled={!canUpdate} loading={loading} />
                    </>
                ) : (
                    <ActionButton label={t('teammates.ai.review')} onPress={review} disabled={loading} />
                )}
            </FooterBar>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        width: '100%',
        maxWidth: CONTENT_MAX_WIDTH,
        alignSelf: 'center',
        gap: 16,
        padding: 16,
        paddingBottom: 32,
    },
    intro: {
        gap: 4,
        paddingHorizontal: 4,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 24,
        color: theme.colors.text,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
    },
    hint: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    warning: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.warning,
    },
    card: {
        gap: 14,
        padding: 16,
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
    },
    loading: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    loadingText: {
        flex: 1,
        gap: 2,
    },
    loadingTitle: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.text,
    },
    errorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    error: {
        ...Typography.default(),
        flex: 1,
        fontSize: 14,
        color: theme.colors.textDestructive,
    },
    link: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    identity: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    identityText: {
        flex: 1,
        gap: 2,
    },
    draftName: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
    },
    draftHandle: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    draftRole: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 21,
        color: theme.colors.text,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHighest,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    instructions: {
        gap: 6,
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.groupped.background,
    },
    instructionsText: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
    },
    question: {
        gap: 10,
    },
    questionText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        lineHeight: 21,
        color: theme.colors.text,
    },
    ready: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 4,
    },
    readyText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
    },
    startOver: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 8,
    },
    startOverText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
}));
