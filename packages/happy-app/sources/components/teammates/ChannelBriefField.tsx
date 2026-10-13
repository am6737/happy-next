import * as React from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { CHANNEL_BRIEF_MAX_CHARS } from 'happy-wire';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { TeammateSheet, useTeammateSheet } from '@/components/teammates/TeammateSheet';
import { Card, FieldError, PillButton, SectionLabel, SheetTextInput } from '@/components/teammates/kit';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/**
 * A group's brief: an excerpt card that opens a sheet for the full text. `value` is undefined while the brief is
 * still being decrypted. `onSave` resolves to whether the sheet may close, so a failed save keeps the draft.
 */
export function ChannelBriefField({ value, onSave, busy = false, error, optional = false }: {
    value: string | null | undefined; onSave: (text: string) => Promise<boolean>; busy?: boolean; error?: string | null; optional?: boolean;
}) {
    const { theme } = useUnistyles();
    const sheet = useTeammateSheet();
    const [draft, setDraft] = React.useState('');
    const current = value ?? '';

    const open = () => {
        setDraft(current);
        sheet.present();
    };
    const save = async () => {
        if (await onSave(draft.trim())) sheet.dismiss();
    };

    return (
        <>
            <SectionLabel title={t('channels.brief')} detail={optional ? t('channels.optional') : undefined} />
            <Card>
                <Pressable accessibilityRole="button" accessibilityLabel={t('channels.brief')} disabled={value === undefined || busy} onPress={open}
                    style={({ pressed }) => [styles.excerptRow, pressed && styles.pressed]}>
                    <Text style={[styles.excerpt, !current && styles.muted]} numberOfLines={3}>
                        {value === undefined ? ' ' : current || t('channels.noBrief')}
                    </Text>
                    <Text style={styles.link}>{t('teammates.wizard.edit')}</Text>
                </Pressable>
            </Card>
            <TeammateSheet ref={sheet.ref} title={t('channels.brief')} size="large">
                <Text style={styles.hint}>{t('channels.briefHint')}</Text>
                <SheetTextInput
                    accessibilityLabel={t('channels.brief')}
                    value={draft}
                    onChangeText={setDraft}
                    maxLength={CHANNEL_BRIEF_MAX_CHARS}
                    editable={!busy}
                    placeholder={t('channels.briefPlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    multiline
                    textAlignVertical="top"
                    style={[styles.input, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0 } as any]}
                />
                <FieldError message={error} />
                <PillButton label={t('channels.settings.save')} disabled={draft.trim() === current} loading={busy} onPress={save} />
            </TeammateSheet>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    excerptRow: {
        gap: 8,
        paddingVertical: 14,
    },
    excerpt: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
    },
    muted: {
        color: theme.colors.textSecondary,
    },
    link: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    hint: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    input: {
        ...Typography.default(),
        flexGrow: 1,
        minHeight: 320,
        padding: 16,
        borderRadius: 18,
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
        backgroundColor: theme.colors.surfaceHigh,
    },
    pressed: {
        opacity: 0.7,
    },
}));
