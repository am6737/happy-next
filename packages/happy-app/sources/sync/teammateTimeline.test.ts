import { describe, expect, it } from 'vitest';
import type { TeammateRun } from 'happy-wire';
import { testTask, testTaskRun } from './teammateTaskTestFixtures';
import { buildTeammateTimeline, startOfLocalDay } from './teammateTimeline';

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
const run = (id: string, patch: Partial<TeammateRun>): TeammateRun => ({ ...testTaskRun, id, taskId: null, ...patch });

describe('buildTeammateTimeline', () => {
    it('groups finished runs by local day, newest first', () => {
        const days = buildTeammateTimeline([
            run('a', { status: 'completed', queuedAt: at(11, 9), startedAt: at(11, 9), finishedAt: at(11, 10) }),
            run('b', { status: 'failed', failureReason: 'context_overflow', queuedAt: at(12, 8), finishedAt: at(12, 9) }),
            run('c', { status: 'completed', queuedAt: at(12, 10), startedAt: at(12, 10), finishedAt: at(12, 11) }),
        ], []);
        expect(days.map(day => day.day)).toEqual([startOfLocalDay(at(12, 0)), startOfLocalDay(at(11, 0))]);
        expect(days[0].items.map(item => item.run.id)).toEqual(['c', 'b']);
        expect(days[0].items.map(item => item.tone)).toEqual(['success', 'failure']);
        expect(days[1].items[0].durationMs).toBe(60 * 60 * 1000);
        expect(days[0].items[1].durationMs).toBeNull();
    });

    it('leaves out runs in flight and completed heartbeats', () => {
        const days = buildTeammateTimeline([
            run('live', { status: 'running', queuedAt: at(12, 9), startedAt: at(12, 9) }),
            run('queued', { status: 'queued', queuedAt: at(12, 9) }),
            run('quiet', { trigger: 'heartbeat', status: 'completed', queuedAt: at(12, 8), finishedAt: at(12, 8) }),
            run('loud', { trigger: 'heartbeat', status: 'failed', queuedAt: at(12, 7), finishedAt: at(12, 7) }),
            run('stopped', { status: 'cancelled', queuedAt: at(12, 6), finishedAt: at(12, 6) }),
        ], []);
        expect(days.flatMap(day => day.items.map(item => [item.run.id, item.tone]))).toEqual([['loud', 'failure'], ['stopped', 'neutral']]);
    });

    it('links runs to their task when it is known', () => {
        const days = buildTeammateTimeline([
            run('a', { taskId: testTask.id, status: 'completed', queuedAt: at(12, 9), finishedAt: at(12, 9) }),
            run('b', { taskId: 'gone', status: 'completed', queuedAt: at(12, 8), finishedAt: at(12, 8) }),
        ], [testTask]);
        expect(days[0].items.map(item => item.task?.id ?? null)).toEqual([testTask.id, null]);
    });

    it('returns no days without runs', () => {
        expect(buildTeammateTimeline(undefined, undefined)).toEqual([]);
    });
});
