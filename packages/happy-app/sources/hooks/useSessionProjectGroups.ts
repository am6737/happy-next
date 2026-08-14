import * as React from 'react';
import { useAllMachines, useLocalSettingMutable } from '@/sync/storage';
import { Machine, Session } from '@/sync/storageTypes';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { t } from '@/text';

export type SessionProjectMachineGroup = {
    machine: Machine | null;
    machineName: string;
    sessions: Session[];
};

export type SessionProjectGroup = {
    path: string;
    collapseKey: string;
    displayPath: string;
    machines: Map<string, SessionProjectMachineGroup>;
    sessions: Session[];
};

export function getSessionProjectCollapseKey(projectPath: string): string {
    return `path:${encodeURIComponent(projectPath)}`;
}

export function useSessionProjectGroups(sessions: Session[]): SessionProjectGroup[] {
    const machines = useAllMachines();
    const machinesMap = React.useMemo(() => {
        const map: Record<string, Machine> = {};
        for (const machine of machines) map[machine.id] = machine;
        return map;
    }, [machines]);

    return React.useMemo(() => {
        const groups = new Map<string, SessionProjectGroup>();
        const unknownText = t('status.unknown');

        for (const session of sessions) {
            const projectPath = session.metadata?.path || '';
            const machineId = session.metadata?.machineId || unknownText;
            const machine = machineId !== unknownText ? machinesMap[machineId] : null;
            const machineName = machine?.metadata?.displayName
                || machine?.metadata?.host
                || (machineId !== unknownText ? machineId : `<${unknownText}>`);

            let projectGroup = groups.get(projectPath);
            if (!projectGroup) {
                projectGroup = {
                    path: projectPath,
                    collapseKey: getSessionProjectCollapseKey(projectPath),
                    displayPath: formatPathRelativeToHome(projectPath, session.metadata?.homeDir),
                    machines: new Map(),
                    sessions: [],
                };
                groups.set(projectPath, projectGroup);
            }

            let machineGroup = projectGroup.machines.get(machineId);
            if (!machineGroup) {
                machineGroup = { machine, machineName, sessions: [] };
                projectGroup.machines.set(machineId, machineGroup);
            }

            machineGroup.sessions.push(session);
            projectGroup.sessions.push(session);
        }

        for (const projectGroup of groups.values()) {
            for (const machineGroup of projectGroup.machines.values()) {
                machineGroup.sessions.sort((a, b) => b.createdAt - a.createdAt);
            }
            projectGroup.sessions.sort((a, b) => b.createdAt - a.createdAt);
        }

        return Array.from(groups.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
    }, [sessions, machinesMap]);
}

export function useCollapsedSessionProjectGroups(
    projectGroups: SessionProjectGroup[],
    selectedSessionId?: string,
) {
    const [collapsedGroups, setCollapsedGroups] = useLocalSettingMutable('collapsedSessionProjectGroups');
    const selectedGroupPath = React.useMemo(() => {
        if (!selectedSessionId) return null;
        return projectGroups.find(group => group.sessions.some(session => session.id === selectedSessionId))?.collapseKey ?? null;
    }, [projectGroups, selectedSessionId]);
    const lastRevealedSessionIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        if (!selectedSessionId || selectedGroupPath === null || lastRevealedSessionIdRef.current === selectedSessionId) {
            return;
        }
        lastRevealedSessionIdRef.current = selectedSessionId;
        if (!collapsedGroups[selectedGroupPath]) return;

        const next = { ...collapsedGroups };
        delete next[selectedGroupPath];
        setCollapsedGroups(next);
    }, [collapsedGroups, selectedGroupPath, selectedSessionId, setCollapsedGroups]);

    const toggleGroup = React.useCallback((collapseKey: string) => {
        const next = { ...collapsedGroups };
        if (next[collapseKey]) delete next[collapseKey];
        else next[collapseKey] = true;
        setCollapsedGroups(next);
    }, [collapsedGroups, setCollapsedGroups]);

    return { collapsedGroups, toggleGroup };
}
