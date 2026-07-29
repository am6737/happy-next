import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    values: new Map<string, string>(),
    set: vi.fn((key: string, value: string) => mocks.values.set(key, value)),
}));

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) { return mocks.values.get(key); }
        set(key: string, value: string) { mocks.set(key, value); }
        delete(key: string) { mocks.values.delete(key); }
    },
}));

describe('sessions cache persistence', () => {
    beforeEach(() => {
        mocks.values.clear();
        mocks.set.mockClear();
        vi.resetModules();
    });

    it('skips an identical whole-cache rewrite', async () => {
        const { saveSessionsCache } = await import('./persistence');
        const data = {
            lastSessionsCursorMs: 123,
            sessions: { session: { id: 'session', active: true, activeAt: 100 } },
            sharedSessions: {},
            sessionDataKeys: {},
        } as any;

        saveSessionsCache('account', data);
        saveSessionsCache('account', data);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('ignores cursor-only and online-heartbeat changes', async () => {
        const { saveSessionsCache } = await import('./persistence');
        const data = {
            lastSessionsCursorMs: 123,
            sessions: { session: { id: 'session', active: true, activeAt: 100 } },
            sharedSessions: {},
            sessionDataKeys: {},
        } as any;

        saveSessionsCache('account', data);
        data.lastSessionsCursorMs = 124;
        data.sessions.session.activeAt = 200;

        saveSessionsCache('account', data);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('writes when durable session content changes', async () => {
        const { saveSessionsCache } = await import('./persistence');
        const data = {
            lastSessionsCursorMs: 123,
            sessions: { session: { id: 'session', active: true, activeAt: 100, metadataVersion: 1 } },
            sharedSessions: {},
            sessionDataKeys: {},
        } as any;

        saveSessionsCache('account', data);
        data.sessions.session.metadataVersion = 2;

        saveSessionsCache('account', data);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });
});
