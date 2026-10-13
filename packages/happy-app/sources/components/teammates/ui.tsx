import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { PermissionMode, Teammate } from 'happy-wire';
import { layout } from '@/components/layout';
import { TeammateApiError } from '@/sync/apiTeammates';
import { t } from '@/text';

export const styles = StyleSheet.create(theme => ({
    screen: { flex: 1, backgroundColor: theme.colors.groupped.background },
    content: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', padding: 16, paddingBottom: 40, gap: 14 },
    card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    text: { color: theme.colors.text, fontSize: 15 },
    title: { color: theme.colors.text, fontSize: 22, fontWeight: '600' },
    heading: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
    muted: { color: theme.colors.textSecondary, fontSize: 13 },
    error: { color: theme.colors.status.error, fontSize: 14 },
    input: { borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, color: theme.colors.text, padding: 12, borderRadius: 8, fontSize: 15, minHeight: 44 },
    chip: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
    button: { backgroundColor: theme.colors.button.primary.background, borderRadius: 8, padding: 12, minHeight: 44, alignItems: 'center' },
    buttonText: { color: theme.colors.button.primary.tint, fontSize: 15, fontWeight: '600' },
}));

export function Action({ title, onPress, disabled = false }: { title: string; onPress?: () => void; disabled?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.45 }]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}

/** Shown until an Agent profile has loaded, with a manual retry. */
export function TeammateLoadFallback({ loading, error, refresh }: { loading: boolean; error: string | null; refresh: () => void }) {
    return (
        <View style={[styles.screen, { padding: 16, gap: 12 }]}>
            {loading && <ActivityIndicator />}
            {error && <Text style={styles.error}>{error}</Text>}
            <Action title={t('common.retry')} onPress={refresh} />
        </View>
    );
}

/** Wire accepts theme tokens as well as hex; unresolved tokens and unset colors use the fallback. */
export function teammateColor(teammate: Pick<Teammate, 'avatar'> | undefined, fallback: string): string {
    const color = teammate?.avatar?.color;
    return color && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ? color : fallback;
}

/** DooTask-style text avatar initials: CJK names keep the last two characters, others the first two letters (or two word initials). */
export function teammateInitials(name: string | undefined): string {
    const clean = (name ?? '')
        .replace(/[(（\[【{［<＜『「].*?[)）\]】}］>＞』」]/gu, '')
        .replace(/[\p{P}\p{S}\p{Extended_Pictographic}_]+/gu, ' ')
        .trim();
    if (!clean) return 'D';
    if (/^[\u4e00-\u9fa5]+$/.test(clean)) return clean.slice(-2);
    const words = clean.split(/\s+/);
    const chars = Array.from(words.length > 1 ? words[0][0] + words[1][0] : words[0]).slice(0, 2).join('');
    return chars.toUpperCase();
}

/** Stable dark background per name, so white initials always read (DooTask uses a random dark color cached per name). */
function teammateHashColor(name: string | undefined): string {
    let hash = 0;
    for (const char of name ?? '') hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    return `hsl(${hash % 360}, 55%, 42%)`;
}

/** Round text avatar: white initials of the name on the chosen color, or a name-derived one when none is set. */
export function TeammateAvatar({ teammate, size = 52 }: { teammate: Pick<Teammate, 'avatar'> & { name?: string }; size?: number }) {
    const backgroundColor = teammateColor(teammate, teammateHashColor(teammate.name));
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: size / 2.6, fontWeight: '600', color: '#ffffff' }}>{teammateInitials(teammate.name)}</Text>
        </View>
    );
}

export function teammatePermissionLabel(mode: PermissionMode): string {
    switch (mode) {
        case 'read-only': return t('agentInput.codexPermissionMode.readOnly');
        case 'on-failure': return t('agentInput.codexPermissionMode.onFailure');
        case 'full-auto': return t('agentInput.codexPermissionMode.fullAuto');
        case 'auto_edit': return t('agentInput.geminiPermissionMode.autoEdit');
        default: return t(`agentInput.permissionMode.${mode}`);
    }
}

export function teammateErrorMessage(error: unknown): string {
    if (error instanceof TeammateApiError) return t(`teammates.errors.${error.code}`);
    return t('teammates.errors.unknown');
}
