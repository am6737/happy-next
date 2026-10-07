import * as React from 'react';
import { useAllMachines, useSetting } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { projectLabels } from '@/utils/projectLabels';
import { formatPathRelativeToHome, getSessionSubtitle } from '@/utils/sessionUtils';
import { t } from '@/text';

/**
 * How session lists name a session's project: its directory name (a worktree's, its repository's),
 * with a detail beside it — the worktree, and for projects whose name another one in the same list
 * has, what tells them apart: their machine if each is on another one, else their parent directory. Only the list's own sessions count, so a name grows a
 * detail only next to the one it could be mistaken for. With the "show full project paths" setting,
 * the full path instead.
 */

export type SessionProjectLabel = {
    name: string;
    detail?: string;
};

export type SessionProjectLabeler = (session: Session) => SessionProjectLabel;

/** Labels for the projects of these sessions, the list they're shown in. */
export function useSessionProjectLabels(sessions: readonly Session[]): SessionProjectLabeler {
    const showFullPath = useSetting('showFullProjectPath');
    const machines = useAllMachines();

    // Sessions change with every message, their projects hardly ever: work on these only when the
    // projects do, so the labeler — and the rows using it — stay the same in between.
    const projectsKey = Array.from(new Set(sessions.flatMap(session => session.metadata
        ? [`${session.metadata.path}\0${session.metadata.homeDir ?? ''}\0${session.metadata.machineId ?? ''}`]
        : []))).sort().join('\n');
    const machineNamesKey = machines
        .map(machine => `${machine.id}\0${machine.metadata?.displayName || machine.metadata?.host || machine.id}`)
        .join('\n');

    return React.useMemo(() => {
        const projects = new Map<string, { display: string; machineIds: Set<string> }>();
        for (const line of projectsKey ? projectsKey.split('\n') : []) {
            const [path, homeDir, machineId] = line.split('\0');
            const project = projects.get(path) ?? { display: formatPathRelativeToHome(path, homeDir || undefined), machineIds: new Set() };
            if (machineId) project.machineIds.add(machineId);
            projects.set(path, project);
        }

        const labels = new Map<string, SessionProjectLabel>();
        if (showFullPath) {
            for (const [path, project] of projects) labels.set(path, { name: project.display });
        } else {
            const machineNames = new Map(machineNamesKey.split('\n').map(line => line.split('\0') as [string, string]));
            const pathsByDisplay = new Map<string, number>();
            for (const project of projects.values()) {
                pathsByDisplay.set(project.display, (pathsByDisplay.get(project.display) ?? 0) + 1);
            }
            const byDisplay = projectLabels(Array.from(projects.values(), project => project.display));
            // Projects with the same name each on a machine of its own are told apart by their machine,
            // which says more than where on it they are.
            const clashes = new Map<string, string[][]>();
            for (const project of projects.values()) {
                const label = byDisplay.get(project.display)!;
                if (!label.parent) continue;
                const key = `${label.name}\0${label.worktree ?? ''}`;
                clashes.set(key, [...(clashes.get(key) ?? []), Array.from(project.machineIds)]);
            }
            const byMachine = new Set(Array.from(clashes).flatMap(([key, machineIds]) => {
                const ids = machineIds.map(ids => ids.length === 1 ? ids[0] : null);
                return ids.every(Boolean) && new Set(ids).size === ids.length ? [key] : [];
            }));
            for (const [path, project] of projects) {
                const label = byDisplay.get(project.display)!;
                const machineName = Array.from(project.machineIds, id => machineNames.get(id) ?? id).join(', ');
                const ownMachine = byMachine.has(`${label.name}\0${label.worktree ?? ''}`);
                const detail = [
                    label.worktree && `${t('sessionInfo.worktree.title')} ${label.worktree}`,
                    ownMachine ? machineName : label.parent,
                    // Paths that read the same, in home directories of other machines: their machine.
                    !ownMachine && pathsByDisplay.get(project.display)! > 1 && machineName,
                ].filter(Boolean).join(' · ');
                labels.set(path, { name: label.name, detail: detail || undefined });
            }
        }

        return (session: Session) => labels.get(session.metadata?.path ?? '') ?? { name: getSessionSubtitle(session) };
    }, [projectsKey, machineNamesKey, showFullPath]);
}

/** The labeler of the list a row is in; one alone names a project by itself. */
export const SessionProjectLabelsContext = React.createContext<SessionProjectLabeler | null>(null);

/** The project of one session row, labelled among the sessions of its list. */
export function useSessionProjectLabel(session: Session): SessionProjectLabel {
    const listLabeler = React.useContext(SessionProjectLabelsContext);
    const ownLabeler = useSessionProjectLabels(listLabeler ? [] : [session]);
    return (listLabeler ?? ownLabeler)(session);
}
