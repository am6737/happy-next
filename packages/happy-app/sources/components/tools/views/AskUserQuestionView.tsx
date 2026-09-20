import * as React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { sessionAllow } from '@/sync/ops';
import { askUserQuestionDraftKey } from '@/sync/askUserQuestionDraft';
import { useAskUserQuestionDraft } from '@/hooks/useAskUserQuestionDraft';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';

interface QuestionOption {
    label: string;
    description: string;
    markdown?: string;
}

interface Question {
    id?: string;
    question: string;
    header: string;
    options: QuestionOption[];
    multiSelect: boolean;
    isOther?: boolean;
    isSecret?: boolean;
}

interface AskUserQuestionInput {
    questions: Question[];
}

interface AskUserQuestionResult {
    answers?: Record<string, string>;
}

const getAnswerForQuestion = (answers: Record<string, string> | undefined, question: Question): string | undefined => {
    if (!answers) {
        return undefined;
    }

    const answer = (question.id ? answers[question.id] : undefined) || answers[question.question] || answers[question.header];
    return question.isSecret && answer ? '********' : answer;
};

// Styles MUST be defined outside the component to prevent infinite re-renders
// with react-native-unistyles. The theme is passed as a function parameter.
const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 16,
    },
    questionSection: {
        gap: 8,
    },
    headerChip: {
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        marginBottom: 4,
    },
    headerText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
    },
    questionText: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 8,
    },
    optionsContainer: {
        gap: 8,
    },
    optionButton: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        gap: 10,
        minHeight: 44, // Minimum touch target for mobile
    },
    optionButtonSelected: {
        backgroundColor: theme.colors.surfaceHigh,
        borderColor: theme.colors.radio.active,
    },
    optionButtonDisabled: {
        opacity: 0.6,
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioOuterSelected: {
        borderColor: theme.colors.radio.active,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.radio.dot,
    },
    checkboxOuter: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxOuterSelected: {
        borderColor: theme.colors.radio.active,
        backgroundColor: theme.colors.radio.active,
    },
    optionContent: {
        flex: 1,
    },
    // react-native-web stamps `user-select: none` on every TouchableOpacity, which makes an
    // option's label and description impossible to copy on web. `user-select` is inherited, so
    // declaring it on the text beats the tappable row above it — and RNW cancels the press when a
    // selectionchange lands mid-gesture, so dragging across the text selects it instead of
    // toggling the option. WebKit (Safari, and the desktop client's WKWebView) also needs the
    // prefixed spelling: it inherited `-webkit-user-select: none` from the row and only that
    // spelling overrides it. Both live under `_web`, so native is untouched.
    optionLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        lineHeight: 20,
        _web: {
            userSelect: 'text',
            WebkitUserSelect: 'text',
        },
    },
    optionDescription: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
        _web: {
            userSelect: 'text',
            WebkitUserSelect: 'text',
        },
    },
    markdownPreview: {
        marginTop: 8,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 6,
        padding: 10,
    },
    markdownPreviewText: {
        fontFamily: Typography.mono().fontFamily,
        fontSize: 12,
        color: theme.colors.text,
        lineHeight: 18,
    },
    otherTextInput: {
        marginTop: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        minHeight: 36,
        maxHeight: 120,
    },
    actionsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 2,
        marginBottom: 2,
        justifyContent: 'flex-end',
    },
    submitButton: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44, // Minimum touch target for mobile
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        fontWeight: '600',
    },
    submittedContainer: {
        gap: 8,
    },
    submittedItem: {
        flexDirection: 'row',
        gap: 8,
    },
    submittedHeader: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    submittedValue: {
        fontSize: 13,
        color: theme.colors.text,
        flex: 1,
    },
}));

export const AskUserQuestionView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const { theme } = useUnistyles();
    // The answer in progress is a draft (store-backed, see useAskUserQuestionDraft) rather than
    // plain state: this row is unmounted whenever it leaves the list's render window — scrolling
    // away, a stream of new messages, a message-syncing reload that re-keys every row — and the
    // user's ticks and typed "Other" text have to come back with it.
    const toolKey = askUserQuestionDraftKey(tool);
    const {
        selections,
        otherTexts,
        isSubmitted,
        toggleOption,
        setOtherText,
        markSubmitted,
        clearDraft,
    } = useAskUserQuestionDraft(sessionId, toolKey);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    // Questions whose "Other" input should take focus on this mount. Restoring a draft mounts an
    // already-open input — inside the list's overscan, before it is even visible — so autoFocus
    // is granted only to an "Other" the user tapped in this mount.
    const focusOtherRef = React.useRef<Set<number>>(new Set());

    // Once the tool has run its course the draft has nothing left to hold: the submitted branch
    // below reads the answers off the tool result itself.
    const isToolFinished = tool.state === 'completed' || tool.state === 'error';
    React.useEffect(() => {
        if (isToolFinished) clearDraft();
    }, [isToolFinished, clearDraft]);

    // Parse input
    const input = tool.input as AskUserQuestionInput | undefined;
    const questions = input?.questions;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return null;
    }

    const isRunning = tool.state === 'running';
    const canInteract = isRunning && !isSubmitted;

    // "Other" is represented as sentinel index = options.length
    const getOtherIndex = (q: Question) => q.options.length;

    // Check if all questions have at least one valid selection
    const allQuestionsAnswered = questions.every((q, qIndex) => {
        if (q.options.length === 0) {
            return Boolean(otherTexts.get(qIndex)?.trim());
        }
        const selected = selections.get(qIndex);
        if (!selected || selected.size === 0) return false;
        // If "Other" is selected, require non-empty text
        if (selected.has(getOtherIndex(q))) {
            const text = otherTexts.get(qIndex);
            if (!text?.trim()) return false;
        }
        return true;
    });

    const handleOptionToggle = React.useCallback((questionIndex: number, optionIndex: number, multiSelect: boolean) => {
        if (!canInteract) return;
        toggleOption(questionIndex, optionIndex, multiSelect);
    }, [canInteract, toggleOption]);

    const handleOtherTextChange = React.useCallback((questionIndex: number, text: string) => {
        setOtherText(questionIndex, text);
    }, [setOtherText]);

    // The "Other" row hands focus to its input only when the user opens it here and now.
    const handleOtherToggle = React.useCallback((questionIndex: number, optionIndex: number, multiSelect: boolean, wasSelected: boolean) => {
        if (!canInteract) return;
        if (wasSelected) {
            focusOtherRef.current.delete(questionIndex);
        } else {
            focusOtherRef.current.add(questionIndex);
        }
        toggleOption(questionIndex, optionIndex, multiSelect);
    }, [canInteract, toggleOption]);

    const handleSubmit = React.useCallback(async () => {
        if (!sessionId || !allQuestionsAnswered || isSubmitting) return;

        setIsSubmitting(true);

        // HACK: Disable the form immediately by switching to the submitted view.
        // Without this, users could edit their selections while the network calls
        // are in flight, but those edits would be ignored since we've already
        // captured the values above. TODO: Revisit this logic.
        // Recorded on the draft too, so a row that remounts mid-flight (scroll, reload) stays
        // submitted instead of handing the form back for a second, ignored submission.
        markSubmitted();

        // Codex uses stable question IDs; Claude looks answers up by full question text.
        const answers: Record<string, string> = {};
        questions.forEach((q, qIndex) => {
            if (q.options.length === 0) {
                answers[q.id || q.question] = otherTexts.get(qIndex)?.trim() || '';
                return;
            }
            const selected = selections.get(qIndex);
            if (selected && selected.size > 0) {
                const otherIndex = getOtherIndex(q);
                const hasOther = selected.has(otherIndex);
                const predefinedLabels = Array.from(selected)
                    .filter(optIndex => optIndex !== otherIndex)
                    .map(optIndex => q.options[optIndex]?.label)
                    .filter(Boolean);

                if (hasOther) {
                    const customText = otherTexts.get(qIndex)?.trim() || '';
                    if (predefinedLabels.length > 0) {
                        // Multi-select: combine predefined labels with custom text
                        answers[q.id || q.question] = [...predefinedLabels, customText].join(', ');
                    } else {
                        answers[q.id || q.question] = customText;
                    }
                } else {
                    answers[q.id || q.question] = predefinedLabels.join(', ');
                }
            }
        });

        try {
            // Approve the permission with answers embedded — no separate sendMessage needed
            if (tool.permission?.id) {
                await sessionAllow(sessionId, tool.permission.id, undefined, undefined, undefined, answers);
            }
        } catch (error) {
            console.error('Failed to submit answer:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [sessionId, questions, selections, otherTexts, allQuestionsAnswered, isSubmitting, markSubmitted, tool.permission?.id]);

    // Show submitted state
    if (isSubmitted || tool.state === 'completed') {
        // Persisted answers from permission (survives re-mount) or completed tool result.
        // Some historical/completed AskUserQuestion payloads store answers only in
        // `result.answers`, not in `permission.answers`, so read both sources.
        const result = tool.result as AskUserQuestionResult | undefined;
        const persistedAnswers = tool.permission?.answers || result?.answers;

        return (
            <ToolSectionView>
                <View style={styles.submittedContainer}>
                    {questions.map((q, qIndex) => {
                        // Build display label from local state
                        const selected = selections.get(qIndex);
                        let displayLabel: string;
                        if (selected && selected.size > 0) {
                            const otherIndex = getOtherIndex(q);
                            const hasOther = selected.has(otherIndex);
                            const predefinedLabels = Array.from(selected)
                                .filter(i => i !== otherIndex)
                                .map(i => q.options[i]?.label)
                                .filter(Boolean);
                            if (hasOther) {
                                const customText = otherTexts.get(qIndex)?.trim() || '';
                                displayLabel = predefinedLabels.length > 0
                                    ? [...predefinedLabels, customText].join(', ')
                                    : customText;
                            } else {
                                displayLabel = predefinedLabels.join(', ');
                            }
                        } else {
                            displayLabel = getAnswerForQuestion(persistedAnswers, q) || '-';
                        }
                        if (q.isSecret && displayLabel !== '-') {
                            displayLabel = '********';
                        }
                        return (
                            <View key={qIndex} style={styles.submittedItem}>
                                <Text style={styles.submittedHeader}>{q.header}:</Text>
                                <Text style={styles.submittedValue}>{displayLabel}</Text>
                            </View>
                        );
                    })}
                </View>
            </ToolSectionView>
        );
    }

    return (
        <ToolSectionView>
            <View style={styles.container}>
                {questions.map((question, qIndex) => {
                    const selectedOptions = selections.get(qIndex) || new Set();
                    const otherIndex = getOtherIndex(question);
                    const isOtherSelected = selectedOptions.has(otherIndex);
                    const isFreeForm = question.options.length === 0;

                    return (
                        <View key={qIndex} style={styles.questionSection}>
                            <View style={styles.headerChip}>
                                <Text style={styles.headerText}>{question.header}</Text>
                            </View>
                            <Text style={styles.questionText}>{question.question}</Text>
                            <View style={styles.optionsContainer}>
                                {question.options.map((option, oIndex) => {
                                    const isSelected = selectedOptions.has(oIndex);

                                    return (
                                        <View key={oIndex}>
                                            <TouchableOpacity
                                                style={[
                                                    styles.optionButton,
                                                    isSelected && styles.optionButtonSelected,
                                                    !canInteract && styles.optionButtonDisabled,
                                                ]}
                                                onPress={() => handleOptionToggle(qIndex, oIndex, question.multiSelect)}
                                                disabled={!canInteract}
                                                activeOpacity={0.7}
                                            >
                                                {question.multiSelect ? (
                                                    <View style={[
                                                        styles.checkboxOuter,
                                                        isSelected && styles.checkboxOuterSelected,
                                                    ]}>
                                                        {isSelected && (
                                                            <Ionicons name="checkmark" size={14} color="#fff" />
                                                        )}
                                                    </View>
                                                ) : (
                                                    <View style={[
                                                        styles.radioOuter,
                                                        isSelected && styles.radioOuterSelected,
                                                    ]}>
                                                        {isSelected && <View style={styles.radioInner} />}
                                                    </View>
                                                )}
                                                <View style={styles.optionContent}>
                                                    <Text style={styles.optionLabel}>{option.label}</Text>
                                                    {option.description && (
                                                        <Text style={styles.optionDescription}>{option.description}</Text>
                                                    )}
                                                </View>
                                            </TouchableOpacity>
                                            {isSelected && option.markdown && (
                                                <View style={styles.markdownPreview}>
                                                    <Text style={styles.markdownPreviewText}>{option.markdown}</Text>
                                                </View>
                                            )}
                                        </View>
                                    );
                                })}

                                {isFreeForm ? (
                                    <TextInput
                                        style={styles.otherTextInput}
                                        value={otherTexts.get(qIndex) || ''}
                                        onChangeText={(text) => handleOtherTextChange(qIndex, text)}
                                        placeholder={t('tools.askUserQuestion.otherPlaceholder')}
                                        placeholderTextColor={theme.colors.textSecondary}
                                        multiline={!question.isSecret}
                                        secureTextEntry={question.isSecret}
                                        editable={canInteract}
                                        textAlignVertical="top"
                                    />
                                ) : question.isOther !== false ? (
                                    <View>
                                        <TouchableOpacity
                                            style={[
                                                styles.optionButton,
                                                isOtherSelected && styles.optionButtonSelected,
                                                !canInteract && styles.optionButtonDisabled,
                                            ]}
                                            onPress={() => handleOtherToggle(qIndex, otherIndex, question.multiSelect, isOtherSelected)}
                                            disabled={!canInteract}
                                            activeOpacity={0.7}
                                        >
                                            {question.multiSelect ? (
                                                <View style={[
                                                    styles.checkboxOuter,
                                                    isOtherSelected && styles.checkboxOuterSelected,
                                                ]}>
                                                    {isOtherSelected && (
                                                        <Ionicons name="checkmark" size={14} color="#fff" />
                                                    )}
                                                </View>
                                            ) : (
                                                <View style={[
                                                    styles.radioOuter,
                                                    isOtherSelected && styles.radioOuterSelected,
                                                ]}>
                                                    {isOtherSelected && <View style={styles.radioInner} />}
                                                </View>
                                            )}
                                            <View style={styles.optionContent}>
                                                <Text style={styles.optionLabel}>{t('tools.askUserQuestion.other')}</Text>
                                            </View>
                                        </TouchableOpacity>
                                        {isOtherSelected && (
                                            <TextInput
                                                style={styles.otherTextInput}
                                                value={otherTexts.get(qIndex) || ''}
                                                onChangeText={(text) => handleOtherTextChange(qIndex, text)}
                                                placeholder={t('tools.askUserQuestion.otherPlaceholder')}
                                                placeholderTextColor={theme.colors.textSecondary}
                                                multiline={!question.isSecret}
                                                secureTextEntry={question.isSecret}
                                                editable={canInteract}
                                                autoFocus={focusOtherRef.current.has(qIndex)}
                                                textAlignVertical="top"
                                            />
                                        )}
                                    </View>
                                ) : null}
                            </View>
                        </View>
                    );
                })}

                {canInteract && (
                    <View style={styles.actionsContainer}>
                        <TouchableOpacity
                            style={[
                                styles.submitButton,
                                (!allQuestionsAnswered || isSubmitting) && styles.submitButtonDisabled,
                            ]}
                            onPress={handleSubmit}
                            disabled={!allQuestionsAnswered || isSubmitting}
                            activeOpacity={0.7}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                            ) : (
                                <Text style={styles.submitButtonText}>{t('tools.askUserQuestion.submit')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </ToolSectionView>
    );
});
