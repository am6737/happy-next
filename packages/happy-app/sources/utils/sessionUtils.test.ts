import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/storage', () => ({ storage: {} }));
vi.mock('@/sync/sync', () => ({ sessionLastViewedAt: new Map(), sync: {} }));
vi.mock('@/sync/ops', () => ({ sessionUpdateMetadataFields: vi.fn() }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { AWAITING_RESPONSE_MAX_MS, isSessionBusy } from './sessionUtils';

const now = 1_000_000;
const idle = { presence: 'online' as const, thinking: false, awaitingResponseSince: null, agentState: null };

describe('isSessionBusy', () => {
    it('is idle when nothing is going on', () => {
        expect(isSessionBusy(idle, now)).toBe(false);
    });

    it('is busy while thinking', () => {
        expect(isSessionBusy({ ...idle, thinking: true }, now)).toBe(true);
    });

    it('is busy while the marker set on send stands, until it expires', () => {
        expect(isSessionBusy({ ...idle, awaitingResponseSince: now - 1_000 }, now)).toBe(true);
        expect(isSessionBusy({ ...idle, awaitingResponseSince: now - AWAITING_RESPONSE_MAX_MS }, now)).toBe(false);
    });

    it('is busy while a permission request waits, even with the heartbeat off', () => {
        const agentState = { requests: { r1: { tool: 'Bash', arguments: {}, createdAt: now } } };
        expect(isSessionBusy({ ...idle, agentState } as any, now)).toBe(true);
        expect(isSessionBusy({ ...idle, agentState: { requests: {} } } as any, now)).toBe(false);
    });

    it('is idle offline, whatever the last signals said', () => {
        expect(isSessionBusy({ ...idle, presence: now - 5_000, thinking: true }, now)).toBe(false);
    });
});
