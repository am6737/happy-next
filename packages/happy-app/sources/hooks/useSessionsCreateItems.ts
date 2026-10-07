// The session list's "+" choices, shared by the phone header and the sidebar's search row: a new
// session — on the machine being viewed when it is online — and adding a machine. A new session
// needs an online machine and a live connection.
import * as React from 'react';
import { useRouter } from 'expo-router';
import { useSocketStatus } from '@/sync/storage';
import { t } from '@/text';
import type { ActionMenuItem } from '@/components/ActionMenu';
import type { SessionListScope } from '@/hooks/useSessionListScope';

export function useSessionsCreateItems(scope: SessionListScope, onAddMachine: () => void): ActionMenuItem[] {
    const router = useRouter();
    const socketStatus = useSocketStatus();
    const connected = socketStatus.status !== 'disconnected' && socketStatus.status !== 'error';
    const anyOnline = scope.groups.some(group => !group.unknown && group.online);
    const selectedMachine = scope.groups.find(group => group.id === scope.selection && !group.unknown);
    const machineId = selectedMachine?.online ? selectedMachine.id : undefined;

    return React.useMemo(() => [
        {
            label: t('sessionScope.newSession'),
            disabled: !connected || !anyOnline,
            onPress: () => router.push(machineId ? `/new?${new URLSearchParams({ machineId }).toString()}` : '/new'),
        },
        { label: t('sessionScope.addMachine'), onPress: onAddMachine },
    ], [connected, anyOnline, machineId, router, onAddMachine]);
}
