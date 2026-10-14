import * as React from 'react';
import { useRouter } from 'expo-router';
import { useMachine } from '@/sync/storage';
import { getMachineCliUpdate, requestCliUpdateCheck, type MachineCliUpdate } from '@/utils/cliUpdate';
import { isSharingSelection, type SessionListSelection } from '@/components/sessionListScope';

const NONE: MachineCliUpdate = { state: 'none' };

/**
 * The CLI update of the machine picked in the session list, shown next to its "+" (the sidebar's
 * search row, the phone's header). Picking a machine also has its daemon look for a new CLI when
 * its last lookup is over 10 minutes old. Opening it goes to the CLI item on the machine page.
 */
export function useSelectedMachineCliUpdate(selection: SessionListSelection) {
    const router = useRouter();
    const machineId = selection !== 'all' && !isSharingSelection(selection) ? selection : null;
    const machine = useMachine(machineId ?? '');
    const update = machineId ? getMachineCliUpdate(machine) : NONE;

    React.useEffect(() => {
        if (machineId) requestCliUpdateCheck(machineId);
    }, [machineId]);

    const open = React.useCallback(() => {
        if (machineId) router.push(`/machine/${machineId}?focus=cli`);
    }, [router, machineId]);

    return { update, open };
}
