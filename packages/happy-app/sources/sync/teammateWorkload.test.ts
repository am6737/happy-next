import { describe, expect, it } from 'vitest';
import type { Teammate, TeammateRun, TeammateTask } from 'happy-wire';
import { getTeammateWorkload } from './teammateWorkload';

const teammate = { status: 'active' } as Teammate;
const task = (status: TeammateTask['status']) => ({ status } as TeammateTask);
const run = (status: TeammateRun['status']) => ({ status } as TeammateRun);
describe('teammate workload', () => {
    it('defaults to idle and ignores terminal activity', () => {
        expect(getTeammateWorkload(teammate)).toBe('idle');
        expect(getTeammateWorkload(teammate, [run('completed'), run('failed'), run('cancelled')], [task('done'), task('cancelled')])).toBe('idle');
    });
    it('prioritizes governance status over activity', () => {
        expect(getTeammateWorkload({ ...teammate, status: 'budget_paused' }, [run('running')], [task('awaiting_input')])).toBe('budgetPaused');
        expect(getTeammateWorkload({ ...teammate, status: 'paused' }, [run('running')])).toBe('paused');
    });
    it('prioritizes human input or review over a running worker', () => {
        expect(getTeammateWorkload(teammate, [run('running')], [task('awaiting_input')])).toBe('waiting');
        expect(getTeammateWorkload(teammate, [], [task('in_review')])).toBe('waiting');
    });
    it('does not count queued runs as working', () => {
        expect(getTeammateWorkload(teammate, [run('queued')])).toBe('idle');
    });
    it.each(['dispatching', 'running'] as const)('shows working for %s runs', status => {
        expect(getTeammateWorkload(teammate, [run(status)])).toBe('working');
    });
    it('shows working for in-progress tasks', () => {
        expect(getTeammateWorkload(teammate, [], [task('in_progress')])).toBe('working');
    });
});
