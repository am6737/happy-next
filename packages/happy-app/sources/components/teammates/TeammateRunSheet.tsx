import React from 'react';
import { Platform, Text } from 'react-native';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { startTeammateRun, triggerDreaming, triggerHeartbeat } from '@/sync/apiTeammates';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { FieldError, OptionPills, PillButton, SheetTextInput } from './kit';
import { TeammateSheet } from './TeammateSheet';
import { teammateErrorMessage } from './ui';

type RunKind = 'work' | 'heartbeat' | 'dreaming';

/**
 * "Run once" sheet: a work run with an optional note, a heartbeat check-in, or a dreaming (memory) pass.
 * Shows what is left of this month's budget; closes once the run is queued.
 */
export const TeammateRunSheet = React.forwardRef<BottomSheetModal, { teammateId: string; remainingUsd: number | null }>(
    function TeammateRunSheet({ teammateId, remainingUsd }, ref) {
        const { theme } = useUnistyles();
        const { credentials } = useAuth();
        const [kind, setKind] = React.useState<RunKind>('work');
        const [note, setNote] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState<string | null>(null);

        const start = async () => {
            if (!credentials || busy) return;
            setBusy(true);
            setError(null);
            try {
                const trimmed = note.trim();
                const { run } = kind === 'heartbeat' ? await triggerHeartbeat(credentials, teammateId)
                    : kind === 'dreaming' ? await triggerDreaming(credentials, teammateId)
                        : await startTeammateRun(credentials, teammateId, trimmed ? { note: trimmed } : {});
                storage.getState().applyTeammateRun(run);
                setNote('');
                if (ref && typeof ref === 'object') ref.current?.dismiss();
            } catch (failure) {
                setError(teammateErrorMessage(failure));
            } finally {
                setBusy(false);
            }
        };

        return (
            <TeammateSheet ref={ref} title={t('teammates.detail.runTitle')} onDismiss={() => setError(null)}>
                {remainingUsd !== null && <Text style={styles.subtitle}>{t('teammates.detail.budgetLeft', { amount: remainingUsd.toFixed(2) })}</Text>}
                <OptionPills<RunKind> value={kind} onChange={setKind} options={[
                    { value: 'work', label: t('teammates.detail.runWork') },
                    { value: 'heartbeat', label: t('teammates.trigger.heartbeat') },
                    { value: 'dreaming', label: t('teammates.trigger.dreaming') },
                ]} />
                {kind === 'work' ? (
                    <SheetTextInput
                        accessibilityLabel={t('teammates.runNote')}
                        value={note}
                        onChangeText={setNote}
                        placeholder={t('teammates.detail.runNotePlaceholder')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        multiline
                        maxLength={4000}
                        editable={!busy}
                        style={[styles.note, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0 } as any]}
                    />
                ) : (
                    <Text style={styles.hint}>{t(kind === 'heartbeat' ? 'teammates.detail.heartbeatHint' : 'teammates.detail.dreamingHint')}</Text>
                )}
                <FieldError message={error} />
                <PillButton label={t('teammates.detail.runStart')} onPress={start} loading={busy} disabled={!credentials} />
            </TeammateSheet>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    subtitle: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: -8,
    },
    note: {
        ...Typography.default(),
        minHeight: 96,
        maxHeight: 200,
        padding: 14,
        borderRadius: 16,
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
        backgroundColor: theme.colors.surfaceHigh,
        textAlignVertical: 'top',
    },
    hint: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        paddingVertical: 8,
    },
}));
