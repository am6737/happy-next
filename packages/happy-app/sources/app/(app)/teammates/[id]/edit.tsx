import React from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TeammateForm } from '@/components/teammates/TeammateForm';
import { useTeammate } from '@/sync/storage';
import { useTeammateProfile } from '@/hooks/useTeammateProfile';
import { styles, TeammateLoadFallback } from '@/components/teammates/ui';
import { t } from '@/text';

export default React.memo(function EditTeammateScreen() {
    const { id, step } = useLocalSearchParams<{ id: string; step?: string }>();
    const teammate = useTeammate(id);
    const { loading, error, refresh } = useTeammateProfile(id, false);
    if (teammate?.status === 'archived') return <View style={styles.screen}><Text style={styles.error}>{t('teammates.errors.archived')}</Text></View>;
    if (teammate) return <TeammateForm key={id} teammate={teammate} initialStep={step} />;
    return <TeammateLoadFallback loading={loading} error={error} refresh={refresh} />;
});
