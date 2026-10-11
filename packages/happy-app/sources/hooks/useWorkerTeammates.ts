import React from 'react';
import { useFocusEffect } from 'expo-router';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { InvalidateSync } from '@/utils/sync';
import { workerTeammateId } from '@/sync/teammateWorkerBadge';
import type { Session } from '@/sync/storageTypes';

/** Session lists also load Agent avatars when the user has not opened the Agents tab. */
export function useWorkerTeammates(sessions: Session[]) {
    const missingAgent = storage(state => sessions.some(session => {
        const id = workerTeammateId(session.metadata);
        return !!id && !state.teammates[id];
    }));
    useFocusEffect(React.useCallback(() => {
        if (!missingAgent) return;
        const loader = new InvalidateSync(sync.refreshTeammates);
        loader.invalidate();
        return () => loader.stop();
    }, [missingAgent]));
}
