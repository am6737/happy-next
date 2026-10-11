import { describe, expect, it } from 'vitest';
import { workerTeammateId } from './teammateWorkerBadge';
describe('worker Agent badge', () => {
    it('selects the Agent ID only for a worker', () => {
        expect(workerTeammateId({ teammate: { id: 'agent', role: 'worker' } })).toBe('agent');
        expect(workerTeammateId({ teammate: { id: 'agent', role: 'controller' } })).toBeNull();
    });
    it('allows legacy and missing metadata', () => {
        expect(workerTeammateId()).toBeNull(); expect(workerTeammateId(null)).toBeNull(); expect(workerTeammateId({})).toBeNull();
    });
});
