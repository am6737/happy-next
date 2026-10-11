import { describe, expect, it } from 'vitest';
import { testTaskRun } from './teammateTaskTestFixtures';
import { isVisibleTeammateRun } from './teammateRunVisibility';

describe('profile run visibility', () => {
    it('hides only completed heartbeat runs without a session', () => {
        expect(isVisibleTeammateRun({ ...testTaskRun, trigger: 'heartbeat', status: 'completed', sessionId: null })).toBe(false);
        expect(isVisibleTeammateRun({ ...testTaskRun, trigger: 'heartbeat', status: 'completed', sessionId: 'session' })).toBe(true);
        expect(isVisibleTeammateRun({ ...testTaskRun, trigger: 'heartbeat', status: 'failed', sessionId: null })).toBe(true);
        expect(isVisibleTeammateRun({ ...testTaskRun, trigger: 'manual', status: 'completed', sessionId: null })).toBe(true);
    });
});
