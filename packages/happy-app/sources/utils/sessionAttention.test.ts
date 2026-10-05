import { describe, expect, it } from 'vitest';
import { Session } from '@/sync/storageTypes';
import { hasLiveCompletion, hasUnreadCompletionSince } from './sessionAttention';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = 1_000 * DAY;

// `metadata` is loosened because each case here cares about one field of it.
type SessionOverrides = Partial<Omit<Session, 'metadata'>> & { metadata?: Partial<Session['metadata']> };

function session(overrides: SessionOverrides = {}): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        metadataVersion: 1,
        metadata: {},
        agentState: { taskCompleted: NOW - MINUTE },
        ...overrides,
    } as Session;
}

describe('hasLiveCompletion', () => {
    it('is true for a recently finished task on an active session', () => {
        expect(hasLiveCompletion(session(), NOW)).toBe(true);
    });

    it('is false without a finished task', () => {
        expect(hasLiveCompletion(session({ agentState: {} }), NOW)).toBe(false);
    });

    it('is false once the session is no longer active', () => {
        expect(hasLiveCompletion(session({ active: false }), NOW)).toBe(false);
    });

    it('is false once the completion is older than the attention window', () => {
        expect(hasLiveCompletion(session({ agentState: { taskCompleted: NOW - 7 * DAY - MINUTE } }), NOW)).toBe(false);
    });

    it('is still true at the edge of the window', () => {
        expect(hasLiveCompletion(session({ agentState: { taskCompleted: NOW - 7 * DAY } }), NOW)).toBe(true);
    });

    it('ignores who has dismissed the completion', () => {
        const dismissed = session({ metadata: { completionDismissedAt: NOW } });
        expect(hasLiveCompletion(dismissed, NOW)).toBe(true);
        expect(hasUnreadCompletionSince(dismissed, NOW, NOW)).toBe(false);
    });
});

describe('hasUnreadCompletionSince', () => {
    it('shows the dot when nothing has been seen or dismissed since the completion', () => {
        expect(hasUnreadCompletionSince(session(), 0, NOW)).toBe(true);
    });

    it('hides the dot once the session has been viewed', () => {
        expect(hasUnreadCompletionSince(session(), NOW - MINUTE, NOW)).toBe(false);
    });

    it('keeps hiding it for a dismissal synced from elsewhere', () => {
        expect(hasUnreadCompletionSince(session({ metadata: { completionDismissedAt: NOW } }), 0, NOW)).toBe(false);
    });

    it('shows the dot again once both are rewound, which is what marking unread does', () => {
        expect(hasUnreadCompletionSince(session({ metadata: { completionDismissedAt: NOW } }), 0, NOW)).toBe(false);
        expect(hasUnreadCompletionSince(session({ metadata: { completionDismissedAt: 0 } }), 0, NOW)).toBe(true);
    });
});
