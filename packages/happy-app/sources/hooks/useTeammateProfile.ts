import React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/auth/AuthContext';
import { storage } from '@/sync/storage';
import { getServerUrl } from '@/sync/serverConfig';
import { fetchTeammate, fetchTeammateRuns, fetchTeammateTasks, fetchTeammateSpend } from '@/sync/apiTeammates';
import { teammateErrorMessage } from '@/components/teammates/ui';

export function useTeammateProfile(id: string, activity = true) {
    const { credentials } = useAuth();
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const generation = React.useRef(0);
    const refresh = React.useCallback(async () => {
        if (!credentials || !id) return;
        const current = ++generation.current;
        const serverUrl = getServerUrl();
        setLoading(true); setError(null);
        try {
            const teammate = await fetchTeammate(credentials, id);
            if (current !== generation.current || serverUrl !== getServerUrl()) return;
            storage.getState().applyTeammates([teammate]);
            if (activity) {
                const runsAtRequest = storage.getState().teammateRuns[id] ?? [];
                const [runs, tasks, spend] = await Promise.all([
                    fetchTeammateRuns(credentials, id), fetchTeammateTasks(credentials, id), fetchTeammateSpend(credentials, id),
                ]);
                if (current === generation.current && serverUrl === getServerUrl()) storage.getState().applyTeammateActivity(id, runs, tasks, spend, runsAtRequest);
            }
        } catch (error) { if (current === generation.current) setError(teammateErrorMessage(error)); }
        finally { if (current === generation.current) setLoading(false); }
    }, [credentials, id, activity]);
    useFocusEffect(React.useCallback(() => { void refresh(); return () => { generation.current++; }; }, [refresh]));
    return { loading, error, refresh };
}
