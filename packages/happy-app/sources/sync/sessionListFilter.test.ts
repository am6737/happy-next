import { describe, expect, it } from 'vitest';
import { isSessionVisibleInList } from './sessionListFilter';
import { MetadataSchema, type Session } from './storageTypes';

function session(id: string, role?: 'controller' | 'worker', active = true): Session {
    return {
        id, active,
        metadata: MetadataSchema.parse({ path: '/work', host: 'machine',
            ...(role ? { teammate: { id: 'agent', role, threadId: 'thread', taskId: 'task' } } : {}),
        }),
    } as Session;
}

describe('controller session list filtering', () => {
    it('hides active and inactive controllers while preserving normal and worker sessions', () => {
        const sessions = [session('controller', 'controller'), session('old-controller', 'controller', false),
            session('normal'), session('worker', 'worker'), session('old-worker', 'worker', false)];
        const visible = sessions.filter(isSessionVisibleInList);
        expect(visible.map(item => item.id)).toEqual(['normal', 'worker', 'old-worker']);
        expect(visible.filter(item => item.active)).toHaveLength(2);
        // Filtering is a projection: direct lookup retains the original controller object.
        expect(sessions.find(item => item.id === 'controller')).toBe(sessions[0]);
    });
    it('keeps sessions with undecrypted or older metadata visible', () => {
        expect(isSessionVisibleInList({ metadata: null })).toBe(true);
        expect(isSessionVisibleInList(session('legacy'))).toBe(true);
    });
    it('preserves wire metadata including optional task IDs and rejects invalid roles', () => {
        expect(session('worker', 'worker').metadata?.teammate).toEqual({ id: 'agent', role: 'worker', threadId: 'thread', taskId: 'task' });
        expect(MetadataSchema.parse({ path: '/work', host: 'machine', teammate: { id: 'agent', role: 'controller', threadId: 'thread' } }).teammate?.taskId).toBeUndefined();
        expect(MetadataSchema.safeParse({ path: '/work', host: 'machine', teammate: { id: 'agent', role: 'invalid', threadId: 'thread' } }).success).toBe(false);
    });
});
