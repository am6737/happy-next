import React from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { fetchTeammateRuns, fetchTeammateTasks } from '@/sync/apiTeammates';
import { mergeTeammateRunSnapshot } from '@/sync/teammateRuns';
import { getServerUrl } from '@/sync/serverConfig';
import { InvalidateSync } from '@/utils/sync';

/** Refreshes Agent workloads for delegation, retrying reads while this screen is focused. */
export function useTeammateDelegationAgents() {
    const { credentials } = useAuth();
    useFocusEffect(React.useCallback(() => {
        let active = true;
        const server = getServerUrl();
        const valid = () => active && !!credentials && sync.tasks.isCurrent(credentials, server);
        const loader = new InvalidateSync(async () => {
            await sync.refreshTeammates();
            if (!valid() || !credentials) return;
            await Promise.all(Object.values(storage.getState().teammates).filter(agent => agent.status === 'active').map(async agent => {
                const runsAtRequest = storage.getState().teammateRuns[agent.id];
                const [runs, tasks] = await Promise.all([fetchTeammateRuns(credentials, agent.id), fetchTeammateTasks(credentials, agent.id)]);
                if (!valid()) return;
                storage.getState().applyTeammateTaskList(tasks);
                // Preserve socket run transitions that happened during the fetch.
                if (valid()) storage.setState(state => ({ teammateRuns: { ...state.teammateRuns,
                    [agent.id]: mergeTeammateRunSnapshot(state.teammateRuns[agent.id], runs, runsAtRequest) } }));
            }));
        });
        loader.invalidate();
        return () => { active = false; loader.stop(); };
    }, [credentials]));
}
