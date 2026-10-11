import { describe, expect, it } from 'vitest';
import type { TeammateRun } from 'happy-wire';
import { mergeTeammateRunSnapshot, upsertTeammateRun } from './teammateRuns';

const queued: TeammateRun = {
    id: 'run', teammateId: 'agent', threadId: 'thread', threadKind: 'heartbeat', trigger: 'manual', status: 'queued',
    attempt: 1, failureReason: null, sessionId: null, taskId: null, costUsd: null,
    queuedAt: 10, startedAt: null, finishedAt: null,
};
const running: TeammateRun = { ...queued, status: 'running', startedAt: 20, sessionId: 'session' };
const completed: TeammateRun = { ...running, status: 'completed', finishedAt: 30, costUsd: 1 };

describe('live teammate runs', () => {
    it('inserts runs before the profile is loaded, updates in place and sorts newest first', () => {
        const newer = { ...queued, id: 'newer', queuedAt: 40 };
        expect(upsertTeammateRun(undefined, queued)).toEqual([queued]);
        expect(upsertTeammateRun([newer, queued], running)).toEqual([newer, running]);
        expect(upsertTeammateRun([running], completed)).toEqual([completed]);
    });
    it('ignores a late POST response after the socket already advanced the run', () => {
        expect(upsertTeammateRun([running], queued)).toEqual([running]);
        expect(upsertTeammateRun([completed], running)).toEqual([completed]);
    });
    it('preserves concurrent socket transitions and newly enqueued runs during a profile refresh', () => {
        const newer = { ...queued, id: 'newer', queuedAt: 40 };
        expect(mergeTeammateRunSnapshot([newer, completed], [queued], [queued])).toEqual([newer, completed]);
    });
    it('accepts refreshed cost data when the run has not changed during the request', () => {
        const billed = { ...completed, costUsd: 2 };
        expect(mergeTeammateRunSnapshot([completed], [billed], [completed])).toEqual([billed]);
    });
    it('keeps a newer snapshot transition over an earlier socket state', () => {
        expect(mergeTeammateRunSnapshot([running], [completed], [queued])).toEqual([completed]);
    });
});
