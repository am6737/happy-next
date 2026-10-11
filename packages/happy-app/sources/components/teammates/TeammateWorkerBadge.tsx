import React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { storage } from '@/sync/storage';
import { workerTeammateId } from '@/sync/teammateWorkerBadge';
import { t } from '@/text';
import { TeammateAvatar } from './ui';

export const TeammateWorkerBadge = React.memo(({ metadata, overlay = false }: {
    metadata?: { teammate?: { id: string; role: string } } | null; overlay?: boolean;
}) => {
    const id = workerTeammateId(metadata);
    const teammate = storage(state => id ? state.teammates[id] : undefined);
    if (!id) return null;
    return <View style={[stylesheet.badge, overlay && stylesheet.overlay]} accessible
        accessibilityLabel={teammate?.name || t('channels.unknownAgent')}>
        <TeammateAvatar teammate={teammate ?? { avatar: null }} size={22} />
    </View>;
});
const stylesheet = StyleSheet.create(theme => ({
    badge: { borderWidth: 2, borderColor: theme.colors.surface, borderRadius: 13 },
    overlay: { position: 'absolute', right: -4, bottom: -4 },
}));
