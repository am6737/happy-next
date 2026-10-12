import React from 'react';
import type { Teammate, TeammateRun } from 'happy-wire';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';
import { archiveTeammate, cancelTeammateRun, updateTeammate } from '@/sync/apiTeammates';
import { isTeammateRunCancellable } from '@/sync/teammateRuns';
import { teammateErrorMessage } from '@/components/teammates/ui';
import { t } from '@/text';

/**
 * Actions on an Agent profile: open its DM, pause or resume, archive, and cancel a run. One action runs at a
 * time (`busy`); destructive ones ask first, and failures are kept in `error` for the page to show inline.
 */
export function useTeammateActions(teammate: Teammate | null | undefined) {
    const router = useRouter();
    const { credentials } = useAuth();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const withBusy = async (work: () => Promise<void>, errorMessage = teammateErrorMessage) => {
        setBusy(true);
        setError(null);
        try { await work(); }
        catch (failure) { setError(errorMessage(failure)); }
        finally { setBusy(false); }
    };

    const message = () => {
        if (!teammate || busy) return;
        void withBusy(async () => {
            const channel = await sync.channels.openDm(teammate);
            router.push(`/channels/${channel.id}`);
        }, () => t('channels.createError'));
    };

    const setPaused = (paused: boolean) => {
        if (!credentials || !teammate || busy) return;
        void withBusy(async () => {
            storage.getState().applyTeammates([await updateTeammate(credentials, teammate.id, { status: paused ? 'paused' : 'active' })]);
        });
    };

    const archive = async () => {
        if (!credentials || !teammate || busy) return;
        if (!await Modal.confirm(t('teammates.archive'), t('teammates.archiveConfirm'), { confirmText: t('teammates.archive'), destructive: true })) return;
        await withBusy(async () => {
            storage.getState().applyTeammates([await archiveTeammate(credentials, teammate.id)]);
        });
    };

    const cancelRun = async (run: TeammateRun) => {
        if (!credentials || busy || !isTeammateRunCancellable(run)) return;
        if (!await Modal.confirm(t('teammates.cancelRun'), t('teammates.cancelRunConfirm'), { confirmText: t('teammates.cancelRun'), destructive: true })) return;
        await withBusy(async () => {
            storage.getState().applyTeammateRun((await cancelTeammateRun(credentials, run.id)).run);
        });
    };

    return { busy, error, canAct: !!credentials, message, setPaused, archive, cancelRun };
}
