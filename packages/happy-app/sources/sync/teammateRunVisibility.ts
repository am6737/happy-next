import type { TeammateRun } from 'happy-wire';

export function isVisibleTeammateRun(run: TeammateRun): boolean {
    return !(run.trigger === 'heartbeat' && run.status === 'completed' && run.sessionId === null);
}
