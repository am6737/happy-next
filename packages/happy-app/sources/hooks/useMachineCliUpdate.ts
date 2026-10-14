import * as React from 'react';
import { Modal } from '@/modal';
import { showToast } from '@/components/Toast';
import { showCliUpdateModal } from '@/components/CliUpdateModal';
import { useHappyAction } from '@/hooks/useHappyAction';
import { machineCheckCliUpdate } from '@/sync/ops';
import { storage } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { getMachineCliUpdate } from '@/utils/cliUpdate';
import { compareVersions } from '@/utils/versionUtils';
import { t } from '@/text';

/**
 * A machine's CLI update as the app shows it (see utils/cliUpdate.ts), with its actions: the
 * "check" button, which has the daemon look the latest version up right now (the answer lands
 * in the machine's daemon state, which then offers the update), and opening the update dialog.
 */
export function useMachineCliUpdate(machine: Machine | null | undefined) {
    const update = React.useMemo(() => getMachineCliUpdate(machine), [machine]);
    const machineId = machine?.id;

    const [checking, checkNow] = useHappyAction(React.useCallback(async () => {
        if (!machineId) return;
        const result = await machineCheckCliUpdate(machineId, 0);
        if (!result) {
            showToast(t('cliUpdate.checkUnsupported'), { icon: null });
            return;
        }
        if (!result.latestVersion) {
            Modal.alert(t('common.error'), t('cliUpdate.checkFailed'));
            return;
        }
        const running = storage.getState().machines[machineId]?.metadata?.happyCliVersion;
        if (running && compareVersions(result.latestVersion, running) <= 0) {
            showToast(t('cliUpdate.upToDate'));
        }
    }, [machineId]));

    const openDetails = React.useCallback(() => {
        if (machineId) showCliUpdateModal(machineId);
    }, [machineId]);

    return { update, checking, checkNow, openDetails };
}
