import { describe, expect, test } from 'vitest';
import { dootaskTasksCacheKey } from './tasksCache';

const profile = { serverUrl: 'https://Dootask.example.com/', userId: 7 };

describe('dootaskTasksCacheKey', () => {
    test('is null without a profile or with a search query', () => {
        expect(dootaskTasksCacheKey(null, { status: 'uncompleted' })).toBeNull();
        expect(dootaskTasksCacheKey(profile, { status: 'uncompleted', search: 'bug' })).toBeNull();
    });

    test('ignores blank search and normalizes the server URL', () => {
        expect(dootaskTasksCacheKey(profile, { status: 'uncompleted', search: '  ' }))
            .toBe(dootaskTasksCacheKey({ serverUrl: 'https://dootask.example.com', userId: 7 }, { status: 'uncompleted' }));
    });

    test('separates accounts and filter combinations', () => {
        const base = dootaskTasksCacheKey(profile, { status: 'uncompleted' });
        expect(dootaskTasksCacheKey({ ...profile, userId: 8 }, { status: 'uncompleted' })).not.toBe(base);
        expect(dootaskTasksCacheKey(profile, { status: 'completed' })).not.toBe(base);
        expect(dootaskTasksCacheKey(profile, { status: 'uncompleted', role: 'owner' })).not.toBe(base);
        expect(dootaskTasksCacheKey(profile, { status: 'uncompleted', projectId: 3 })).not.toBe(base);
    });
});
