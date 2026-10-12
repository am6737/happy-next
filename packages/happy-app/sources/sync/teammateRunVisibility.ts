import type { TeammateRun } from 'happy-wire';

/** Completed heartbeat runs are routine noise; failed or cancelled ones stay visible. */
export function isVisibleTeammateRun(run: TeammateRun): boolean {
    return !(run.trigger === 'heartbeat' && run.status === 'completed');
}
