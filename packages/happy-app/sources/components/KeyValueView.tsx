import * as React from 'react';
import { Text, View, Platform, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { CodeView } from './CodeView';
import { LongPressCopy, useCopySelectable } from './LongPressCopy';
import { showCopiedToast, showToast } from './Toast';
import { normalizePreviewHtmlToolName, PREVIEW_HTML_TOOL } from '@/sync/typesMessage';
import { t } from '@/text';
import {
    type OrchestratorSubmitTaskInput,
    formatPromptPreview,
    isOrchestratorSubmitToolName,
    parseOrchestratorSubmitTasks,
} from './keyValueOrchestratorSubmit';

interface KeyValueViewProps {
    data: Record<string, unknown>;
    plain?: boolean;
}

function formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function isSimpleValue(value: unknown): boolean {
    return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export const KeyValueView = React.memo<KeyValueViewProps>(({ data, plain = false }) => {
    const entries = Object.entries(data);
    const selectable = useCopySelectable();
    const allText = entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join('\n');

    return (
        <LongPressCopy text={allText} format="plain">
            <View style={plain ? undefined : styles.container}>
                {entries.map(([key, value], index) => (
                    <View key={key} style={[styles.row, index < entries.length - 1 && styles.rowBorder]}>
                        <Text style={styles.key} numberOfLines={1}>{key}</Text>
                        {isSimpleValue(value) ? (
                            <Text style={styles.value} selectable={selectable}>{formatValue(value)}</Text>
                        ) : plain ? (
                            <Text style={styles.structuredValue} selectable={selectable}>{formatValue(value)}</Text>
                        ) : (
                            <View style={styles.complexValue}>
                                <CodeView code={formatValue(value)} language="json" />
                            </View>
                        )}
                    </View>
                ))}
            </View>
        </LongPressCopy>
    );
});

function InputCopyButton({ text, label }: { text: string; label: string }) {
    const { theme } = useUnistyles();
    const copyText = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(text);
            showCopiedToast();
        } catch {
            showToast(t('textSelection.failedToCopy'), { icon: 'alert-circle-outline' });
        }
    }, [text]);

    return (
        <Pressable
            style={styles.inputCopyButton}
            onPress={copyText}
            accessibilityRole="button"
            accessibilityLabel={`${t('common.copy')} ${label}`}
        >
            <Ionicons name="copy-outline" size={18} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

function ExpandableInputText({ label, text, preview, language, expandLabel, collapseLabel, plain = false }: {
    label: string;
    text: string;
    preview?: string;
    language?: string;
    expandLabel: string;
    collapseLabel: string;
    plain?: boolean;
}) {
    const { theme } = useUnistyles();
    const selectable = useCopySelectable();
    const [expanded, setExpanded] = React.useState(false);
    const canExpand = preview === undefined || preview !== text;
    const stats = React.useMemo(() => ({
        characters: text.length,
        lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    }), [text]);

    React.useEffect(() => setExpanded(false), [text]);
    const toggleLabel = expanded ? collapseLabel : expandLabel;
    const showFullText = expanded || !canExpand;

    return (
        <View style={plain ? styles.plainInputText : styles.container}>
            <View style={styles.inputTextHeader}>
                <Pressable
                    style={styles.inputTextToggle}
                    disabled={!canExpand}
                    onPress={() => setExpanded((value) => !value)}
                    accessibilityRole={canExpand ? 'button' : undefined}
                    accessibilityLabel={canExpand ? toggleLabel : label}
                    accessibilityState={canExpand ? { expanded } : undefined}
                >
                    {canExpand && <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={theme.colors.textSecondary} />}
                    <View style={styles.inputTextSummary}>
                        <Text style={styles.key}>{label}</Text>
                        <Text style={styles.inputTextStats}>{t('tools.inputText.stats', stats)}</Text>
                    </View>
                    {canExpand && <Text style={styles.inputTextAction}>{toggleLabel}</Text>}
                </Pressable>
                <InputCopyButton text={text} label={label} />
            </View>
            {showFullText && !plain ? <CodeView code={text} language={language} /> : (showFullText || preview !== undefined) && (
                <LongPressCopy text={text} language={language ?? 'plaintext'}>
                    <View style={styles.inputTextPreview}>
                        <Text style={showFullText ? styles.structuredValue : styles.taskPromptText} selectable={selectable}>{showFullText ? text : preview}</Text>
                    </View>
                </LongPressCopy>
            )}
        </View>
    );
}

function PreviewHtmlInputView({ input }: { input: Record<string, unknown> & { html: string } }) {
    const { html, ...parameters } = input;
    return (
        <View style={styles.inputSections}>
            {Object.keys(parameters).length > 0 && <KeyValueView data={parameters} />}
            <ExpandableInputText
                label="html"
                text={html}
                language="html"
                expandLabel={t('tools.previewHtml.expandSource')}
                collapseLabel={t('tools.previewHtml.collapseSource')}
            />
        </View>
    );
}

function OrchestratorSubmitTaskView({ task, index }: { task: OrchestratorSubmitTaskInput; index: number }) {
    const taskTitle = task.title || task.taskKey || `${t('tools.names.task')} ${index + 1}`;
    const parameters = Object.fromEntries(Object.entries(task.input).filter(([key]) => key !== 'prompt' || task.prompt === undefined));

    return (
        <View style={styles.container}>
            <View style={[styles.taskHeader, styles.taskCardHeader]}>
                <Text style={styles.taskTitle} numberOfLines={1}>#{index + 1} {taskTitle}</Text>
                <InputCopyButton text={formatValue(task.input)} label={taskTitle} />
            </View>
            {Object.keys(parameters).length > 0 && <KeyValueView data={parameters} plain />}
            {task.prompt !== undefined && (
                <ExpandableInputText
                    plain
                    label="prompt"
                    text={task.prompt}
                    preview={formatPromptPreview(task.prompt)}
                    expandLabel={t('tools.orchestratorSubmit.expandPrompt')}
                    collapseLabel={t('tools.orchestratorSubmit.collapsePrompt')}
                />
            )}
        </View>
    );
}

function OrchestratorSubmitInputView({ input }: { input: Record<string, unknown> }) {
    const { tasks: tasksRaw, ...parameters } = input;
    const tasks = parseOrchestratorSubmitTasks(tasksRaw);

    return (
        <View style={styles.inputSections}>
            {Object.keys(parameters).length > 0 && <KeyValueView data={parameters} />}
            <View>
                <View style={styles.taskHeader}>
                    <Text style={styles.key} numberOfLines={1}>tasks</Text>
                    <InputCopyButton text={formatValue(input)} label={t('tools.fullView.inputParams')} />
                </View>
                {tasks.length > 0 && Array.isArray(tasksRaw) && tasks.length === tasksRaw.length ? (
                    <View style={styles.tasksList}>
                        {tasks.map((task, index) => <OrchestratorSubmitTaskView key={index} task={task} index={index} />)}
                    </View>
                ) : (
                    <View style={styles.complexValue}>
                        <CodeView code={formatValue(tasksRaw)} language="json" />
                    </View>
                )}
            </View>
        </View>
    );
}

/**
 * Tries to render data as key-value pairs.
 * Falls back to CodeView with raw JSON if the input is not a plain object.
 */
export function ToolInputView({ input, toolName }: { input: unknown; toolName?: string }) {
    if (input == null) {
        return <CodeView code="null" language="json" />;
    }

    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const objectInput = input as Record<string, unknown>;
        if (Object.keys(objectInput).length === 0) {
            return <CodeView code="{}" language="json" />;
        }
        if (isOrchestratorSubmitToolName(toolName)) {
            return <OrchestratorSubmitInputView input={objectInput} />;
        }
        if (toolName && normalizePreviewHtmlToolName(toolName) === PREVIEW_HTML_TOOL && typeof objectInput.html === 'string') {
            return <PreviewHtmlInputView input={objectInput as Record<string, unknown> & { html: string }} />;
        }
        return <KeyValueView data={objectInput} />;
    }

    // Fallback: raw JSON
    try {
        const serialized = JSON.stringify(input, null, 2);
        return <CodeView code={serialized ?? String(input)} language="json" />;
    } catch {
        return <CodeView code={String(input)} />;
    }
}

/**
 * Smart view for tool output: if the data is a plain object, render as key-value pairs.
 * If it's a JSON string that parses to an object, render as key-value pairs.
 * Otherwise, render as raw text in CodeView.
 */
export function SmartDataView({ data }: { data: unknown }) {
    // Already an object
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return <KeyValueView data={data as Record<string, unknown>} />;
    }

    // String: try to parse as JSON object
    if (typeof data === 'string') {
        const trimmed = data.trim();
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return <KeyValueView data={parsed as Record<string, unknown>} />;
                }
            } catch {
                // Not valid JSON, fall through
            }
        }
        return <CodeView code={data} />;
    }

    // Fallback
    try {
        return <CodeView code={JSON.stringify(data, null, 2)} language="json" />;
    } catch {
        return <CodeView code={String(data)} />;
    }
}

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 6,
        overflow: 'hidden',
    },
    row: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    rowBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.modal.border,
    },
    key: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        marginBottom: 4,
    },
    value: {
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 19,
    },
    complexValue: {
        marginTop: 2,
    },
    structuredValue: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        fontSize: 12,
        color: theme.colors.text,
        lineHeight: 18,
    },
    inputSections: {
        gap: 12,
    },
    plainInputText: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.modal.border,
        paddingTop: 4,
    },
    inputTextHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    inputTextToggle: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 8,
    },
    inputTextSummary: {
        flex: 1,
    },
    inputTextStats: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    inputTextAction: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    inputCopyButton: {
        padding: 14,
    },
    inputTextPreview: {
        paddingHorizontal: 12,
        paddingBottom: 12,
    },
    tasksList: {
        gap: 12,
    },
    taskCardHeader: {
        paddingLeft: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.modal.border,
    },
    taskHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    taskTitle: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
    },
    taskPromptText: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.text,
    },
}));
