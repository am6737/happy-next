import React from 'react';
import type { TeammateSkillInfo } from 'happy-wire';
import { listTeammateSkills } from '@/sync/teammateSkills';

export type MachineSkillsState =
    | { status: 'idle' | 'loading' | 'unavailable'; skills: TeammateSkillInfo[] }
    | { status: 'ready'; skills: TeammateSkillInfo[] };

/**
 * Loads the Skills installed on a machine whenever `machineId` changes (and `enabled`).
 * A failed load is never an error state: it becomes 'unavailable' and the UI shows saved names read-only.
 * Responses for a machine that is no longer selected are dropped.
 */
export function useMachineSkills(machineId: string | undefined, enabled = true): MachineSkillsState {
    const [state, setState] = React.useState<MachineSkillsState>({ status: 'idle', skills: [] });
    React.useEffect(() => {
        if (!machineId || !enabled) {
            setState({ status: 'idle', skills: [] });
            return;
        }
        let cancelled = false;
        setState({ status: 'loading', skills: [] });
        void listTeammateSkills(machineId).then(result => {
            if (cancelled) return;
            setState(result.status === 'ready' ? { status: 'ready', skills: result.skills } : { status: 'unavailable', skills: [] });
        });
        return () => { cancelled = true; };
    }, [machineId, enabled]);
    return state;
}
