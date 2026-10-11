import type { Teammate, TeammateTaskDelegateRequest } from 'happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { delegateTeammateTask } from './apiTeammateTasks';

/** The app must wrap the DM key before the task can publish reports or decisions. */
export async function delegateIssueToTeammate(credentials: AuthCredentials, teammate: Teammate,
    issue: Omit<TeammateTaskDelegateRequest, 'teammateId'>,
    channels: { openDm: (teammate: Teammate) => Promise<unknown> }, isCurrent = () => true) {
    await channels.openDm(teammate);
    if (!isCurrent()) throw new Error('Account or server changed');
    const task = await delegateTeammateTask(credentials, { ...issue, teammateId: teammate.id });
    if (!isCurrent()) throw new Error('Account or server changed');
    return task;
}
