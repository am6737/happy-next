import { useCallback } from 'react';
import { Modal } from '@/modal';
import { showToast } from '@/components/Toast';
import { useHappyAction } from '@/hooks/useHappyAction';
import { machineUpdateCli } from '@/sync/ops';
import type { CliUpdateStatus, Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { t } from '@/text';

// States in which the daemon has a newer version it has not installed yet
const UPDATABLE_STATES = ['available', 'failed', 'disabled'];

function describeCliUpdate(status: CliUpdateStatus): string | null {
    const version = status.latestVersion ?? '';
    switch (status.state) {
        case 'up-to-date':
            return t('cliUpdate.statusUpToDate');
        case 'installing':
            return t('cliUpdate.statusInstalling', { version });
        case 'installed':
            return t('cliUpdate.statusInstalled', { version });
        case 'failed':
            return t('cliUpdate.statusFailed', { version, error: status.error ?? '' });
        case 'disabled':
            return status.latestVersion ? t('cliUpdate.statusDisabled', { version }) : null;
        case 'unsupported':
            return status.reason === 'no-permission' ? t('cliUpdate.statusNoPermission') : t('cliUpdate.statusNotGlobal');
        case 'available':
            if (status.waitingFor === 'sessions' && status.installBy) {
                return t('cliUpdate.statusWaitingSessions', { version, time: new Date(status.installBy).toLocaleString() });
            }
            if (status.waitingFor === 'executions' || status.waitingFor === 'terminals') {
                return t('cliUpdate.statusWaitingBusy', { version });
            }
            return t('cliUpdate.statusAvailable', { version });
        default:
            return null;
    }
}

/**
 * The CLI auto-update a machine's daemon reports, and an action to install
 * the latest version on it right away. `status` is undefined for daemons
 * that predate auto-update (they do not answer `update-cli` either).
 */
export function useMachineCliUpdate(machine: Machine | null | undefined) {
    const status = machine?.daemonState?.cliUpdate;
    const online = !!machine && isMachineOnline(machine);
    const machineId = machine?.id;
    const latestVersion = status?.latestVersion ?? '';

    const [updating, install] = useHappyAction(useCallback(async () => {
        if (!machineId) return;
        const result = await machineUpdateCli(machineId);
        const version = result.latestVersion ?? latestVersion;
        switch (result.status) {
            case 'started':
                showToast(t('cliUpdate.started', { version }));
                break;
            case 'up-to-date':
                showToast(t('cliUpdate.upToDate'));
                break;
            case 'busy':
                showToast(t('cliUpdate.busy'));
                break;
            case 'unsupported':
                Modal.alert(t('common.error'), result.reason === 'no-permission' ? t('cliUpdate.statusNoPermission') : t('cliUpdate.statusNotGlobal'));
                break;
            default:
                Modal.alert(t('common.error'), t('cliUpdate.checkFailed'));
        }
    }, [machineId, latestVersion]));

    const update = useCallback(() => {
        Modal.alert(
            t('cliUpdate.confirmTitle'),
            t('cliUpdate.confirmMessage', { version: latestVersion }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('cliUpdate.updateNow'), onPress: install },
            ]
        );
    }, [latestVersion, install]);

    return {
        status,
        subtitle: online && status ? describeCliUpdate(status) : null,
        canUpdate: online && !!status?.latestVersion && UPDATABLE_STATES.includes(status.state) && !updating,
        updating,
        update,
    };
}
