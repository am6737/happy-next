import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TeammateForm } from '@/components/teammates/TeammateForm';
import { takeTeammateSeed } from '@/sync/teammateDraft';

export default React.memo(function ManualTeammateScreen() {
    const { seed: seedKey } = useLocalSearchParams<{ seed?: string }>();
    // A seed is consumed once, so read it on first render only.
    const [seed] = React.useState(() => seedKey ? takeTeammateSeed(seedKey) : undefined);
    return <TeammateForm seed={seed} />;
});
