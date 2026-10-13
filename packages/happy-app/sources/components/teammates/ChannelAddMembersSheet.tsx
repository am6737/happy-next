import React from 'react';
import { Text } from 'react-native';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { Teammate } from 'happy-wire';
import { StyleSheet } from 'react-native-unistyles';
import { useTeammates } from '@/sync/storage';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Card, PillButton } from './kit';
import { MemberRow } from './MemberRow';
import { TeammateSheet } from './TeammateSheet';

/** Pick Agents that are not in the group yet, up to the space left; closes once they were added. */
export const ChannelAddMembersSheet = React.forwardRef<BottomSheetModal, {
    memberIds: string[];
    remaining: number;
    busy: boolean;
    onAdd: (teammates: Teammate[]) => Promise<boolean>;
}>(function ChannelAddMembersSheet({ memberIds, remaining, busy, onAdd }, ref) {
    const candidates = useTeammates().filter(teammate => teammate.status !== 'archived' && !memberIds.includes(teammate.id));
    const [selected, setSelected] = React.useState<string[]>([]);
    const chosen = candidates.filter(teammate => selected.includes(teammate.id));

    const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]);
    const add = async () => {
        if (!await onAdd(chosen)) return;
        if (ref && typeof ref === 'object') ref.current?.dismiss();
    };

    return (
        <TeammateSheet ref={ref} title={t('channels.settings.add')} size="large" onDismiss={() => setSelected([])}>
            <Text style={styles.hint}>{t('channels.settings.recentHint')}</Text>
            <Card>
                {candidates.length ? candidates.map(teammate => {
                    const checked = selected.includes(teammate.id);
                    return (
                        <MemberRow
                            key={teammate.id}
                            teammate={teammate}
                            checked={checked}
                            disabled={busy || (!checked && selected.length >= remaining)}
                            onToggle={() => toggle(teammate.id)}
                        />
                    );
                }) : <Text style={styles.empty}>{t('channels.settings.empty')}</Text>}
            </Card>
            <PillButton label={t('channels.settings.add')} disabled={!chosen.length} loading={busy} onPress={add} />
        </TeammateSheet>
    );
});

const styles = StyleSheet.create((theme) => ({
    hint: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: -8,
    },
    empty: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        paddingVertical: 18,
    },
}));
