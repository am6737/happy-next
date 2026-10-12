import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { Teammate } from 'happy-wire';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/MultiTextInput';
import { GlassSurface } from '@/components/GlassSurface';
import { NativeMenu } from '@/components/NativeMenu';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { TeammateAvatar } from './ui';

// An @mention being typed right before the cursor, not part of an email or another ASCII word. Names may be CJK, so
// "@" may follow CJK text directly, and the query stops at whitespace.
const MENTION_QUERY = /(?:^|[^A-Za-z0-9_@.-])@([^\s@]*)$/u;

/**
 * The channel composer, built like the DooTask `ChatInput`: a "+" menu, a pill-shaped input and a round
 * send button. Groups suggest @mentions by name while one is typed; a task reply shows as DooTask's reply bar.
 */
export const ChannelComposer = React.memo(({ kind, members, replyTitle, onDismissReply, disabled, onSend, onReset, glass = false }: {
    kind?: 'dm' | 'group';
    members: Teammate[];
    /** The task the next message answers, if any. */
    replyTitle: string | null;
    onDismissReply: () => void;
    disabled: boolean;
    /** `clear` empties the input unless it was edited after sending. */
    onSend: (text: string, clear: () => void) => void;
    onReset: () => void;
    /** Floating over the chat (see `floatingComposerAvailable`): no bar behind it, glass pieces instead. */
    glass?: boolean;
}) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const inputRef = React.useRef<MultiTextInputHandle>(null);
    const [draft, setDraft] = React.useState('');
    const [cursor, setCursor] = React.useState(0);
    const [menuVisible, setMenuVisible] = React.useState(false);

    const query = kind === 'group' ? draft.slice(0, cursor).match(MENTION_QUERY) : null;
    const suggestions = query ? members.filter(member => member.name.toLowerCase().includes(query[1].toLowerCase())) : [];
    const canSend = !disabled && draft.trim().length > 0;

    const handleSelectionChange = React.useCallback((selection: { start: number; end: number }) => setCursor(selection.end), []);
    const handleSend = () => {
        if (!canSend) return;
        const text = draft;
        onSend(text, () => setDraft(current => current === text ? '' : current));
    };
    const insertMention = (member: Teammate) => {
        const start = cursor - (query?.[1].length ?? 0) - 1;
        const prefix = `${draft.slice(0, start)}@${member.name} `;
        inputRef.current?.setTextAndSelection(prefix + draft.slice(cursor), { start: prefix.length, end: prefix.length });
    };
    const menuItems: ActionMenuItem[] = React.useMemo(() => [
        { label: t('channels.newContext'), onPress: onReset },
    ], [onReset]);

    return (
        <View style={[styles.container, glass && styles.containerFloating, { paddingBottom: Platform.OS === 'ios' ? 0 : Math.max(insets.bottom, 12) }]}>
            {suggestions.length > 0 && (
                <GlassSurface glass={glass} color={theme.colors.surfaceHigh} style={styles.suggestions}>
                    {suggestions.map(member => (
                        <Pressable key={member.id} accessibilityRole="button" onPress={() => insertMention(member)} style={styles.suggestion}>
                            <TeammateAvatar teammate={member} size={24} />
                            <Text style={styles.suggestionName} numberOfLines={1}>{member.name}</Text>
                            {!!member.role && <Text style={styles.suggestionRole} numberOfLines={1}>{member.role}</Text>}
                        </Pressable>
                    ))}
                </GlassSurface>
            )}
            {replyTitle !== null && (
                <GlassSurface glass={glass} color={theme.colors.surfaceHigh} style={styles.replyBar}>
                    <View style={styles.replyContent}>
                        <Text style={styles.replyLabel} numberOfLines={1}>{t('teammateTasks.tag')}</Text>
                        <Text style={styles.replyText} numberOfLines={1}>{t('teammateTasks.replying', { title: replyTitle })}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('teammateTasks.dismiss')} onPress={onDismissReply} hitSlop={8} style={styles.replyClose}>
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </GlassSurface>
            )}
            <View style={styles.inputRow}>
                <NativeMenu items={menuItems} disabled={disabled} style={styles.addButton} onFallbackOpen={() => setMenuVisible(true)}>
                    <GlassSurface glass={glass} color={theme.colors.surfaceHighest} style={styles.addCircle}>
                        <Ionicons name="add" size={24} color={theme.colors.textSecondary} />
                    </GlassSurface>
                </NativeMenu>
                <GlassSurface glass={glass} color={theme.colors.surfaceHighest} style={styles.inputGroup}>
                    <MultiTextInput
                        ref={inputRef}
                        style={styles.input}
                        value={draft}
                        onChangeText={setDraft}
                        onSelectionChange={handleSelectionChange}
                        placeholder={t(kind === 'group' ? 'channels.groupCompose' : 'channels.compose')}
                        maxHeight={120}
                        paddingTop={6}
                        paddingBottom={6}
                        lineHeight={20}
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel={t('channels.send')} accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={handleSend} hitSlop={4} style={styles.sendButton}>
                        <View style={[styles.sendCircle, !canSend && styles.sendCircleDisabled]}>
                            <Ionicons name="arrow-up" size={20} color={theme.colors.button.primary.tint} />
                        </View>
                    </Pressable>
                </GlassSurface>
            </View>
            <ActionMenuModal visible={menuVisible} items={menuItems} onClose={() => setMenuVisible(false)} deferItemPress />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.header.background,
        paddingHorizontal: 10,
        paddingTop: theme.margins.xs,
    },
    containerFloating: {
        backgroundColor: 'transparent',
    },
    suggestions: {
        borderRadius: theme.borderRadius.md,
        marginTop: theme.margins.sm,
        marginHorizontal: theme.margins.xs,
        paddingVertical: theme.margins.xs,
    },
    suggestion: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        paddingHorizontal: theme.margins.md,
        paddingVertical: theme.margins.sm,
    },
    suggestionName: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        flexShrink: 1,
        color: theme.colors.text,
    },
    suggestionRole: {
        ...Typography.default(),
        fontSize: 13,
        flexShrink: 1,
        color: theme.colors.textSecondary,
    },
    replyBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.margins.sm,
        paddingHorizontal: theme.margins.sm,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.textLink,
        borderRadius: theme.borderRadius.sm,
        marginTop: theme.margins.sm,
        marginHorizontal: theme.margins.xs,
    },
    replyContent: {
        flex: 1,
        marginRight: theme.margins.sm,
    },
    replyLabel: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textLink,
    },
    replyText: {
        ...Typography.default(),
        fontSize: 13,
        marginTop: 2,
        color: theme.colors.textSecondary,
    },
    replyClose: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingVertical: theme.margins.sm,
        gap: theme.margins.sm,
    },
    addButton: {
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 1,
    },
    addCircle: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputGroup: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderRadius: 22,
        paddingLeft: theme.margins.md + 4,
        paddingRight: 4,
        minHeight: 44,
    },
    input: {
        flex: 1,
        paddingVertical: 6,
    },
    sendButton: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginBottom: 5,
    },
    sendCircle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    sendCircleDisabled: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
}));
