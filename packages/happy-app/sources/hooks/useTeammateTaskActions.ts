import React from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { getServerUrl } from '@/sync/serverConfig';
import { updateTeammateTask } from '@/sync/apiTeammateTasks';
import { openExternalUrl } from '@/utils/tauri';
import { t } from '@/text';

/**
 * Pause, resume and cancel for one task, plus opening its pull request.
 *
 * One lock covers all three status changes so a second tap cannot race the first. Cancelling asks for
 * confirmation first. Results are dropped when the account or server changed while the request was in flight.
 */
export function useTeammateTaskActions(id: string, prUrl: string | null | undefined) {
    const { credentials } = useAuth();
    const lock = React.useRef(false);
    const change = async (action: 'stop' | 'resume' | 'cancel') => {
        if (!credentials || lock.current) return;
        lock.current = true;
        const server = getServerUrl();
        try {
            if (action === 'cancel' && !await Modal.confirm(t('teammateTasks.cancel'), t('teammateTasks.cancelConfirm'), {
                confirmText: t('teammateTasks.cancel'),
                destructive: true,
            })) return;
            if (!sync.tasks.isCurrent(credentials, server)) return;
            const task = await updateTeammateTask(credentials, id, action);
            if (!sync.tasks.isCurrent(credentials, server)) return;
            storage.getState().applyTeammateTask(task);
            sync.tasks.invalidate(id);
        } catch {
            Modal.alert(t('teammateTasks.title'), t('teammateTasks.error'));
        } finally {
            lock.current = false;
        }
    };
    const [pausing, pause] = useHappyAction(() => change('stop'));
    const [resuming, resume] = useHappyAction(() => change('resume'));
    const [cancelling, cancel] = useHappyAction(() => change('cancel'));
    const [openingPr, openPr] = useHappyAction(async () => {
        if (!prUrl) return;
        try {
            await openExternalUrl(prUrl);
        } catch {
            Modal.alert(t('teammateTasks.title'), t('channels.linkError'));
        }
    });
    return {
        canAct: !!credentials,
        busy: pausing || resuming || cancelling,
        pausing,
        resuming,
        openingPr,
        pause,
        resume,
        cancel,
        openPr,
    };
}
