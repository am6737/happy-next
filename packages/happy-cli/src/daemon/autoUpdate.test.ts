import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliUpdateStatus } from '@/api/types';

const env = vi.hoisted(() => ({
    latest: '0.13.0' as string | null,
    installedAfter: '0.13.0',
    installError: null as string | null,
    support: { supported: true, packageManager: 'npm', sudo: false } as any,
    settings: {} as Record<string, unknown>,
    installs: 0,
    installedWithSudo: [] as boolean[],
}));

vi.mock('@/configuration', () => ({ configuration: { currentCliVersion: '0.12.0', disableAutoUpdate: false } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/persistence', () => ({ readSettings: async () => env.settings }));
vi.mock('@/update/cliUpdate', async (importOriginal) => ({
    compareVersions: (await importOriginal<typeof import('@/update/cliUpdate')>()).compareVersions,
    fetchLatestVersion: async () => env.latest,
    checkAutoUpdateSupport: async () => env.support,
    acquireUpdateLock: async () => async () => {},
    readInstalledVersion: async () => env.installedAfter,
    installLatest: async (_pm: string, sudo: boolean) => {
        env.installs++;
        env.installedWithSudo.push(sudo);
        if (env.installError) throw new Error(env.installError);
    },
}));

import { startCliAutoUpdate, type MachineActivity } from './autoUpdate';
import { compareVersions } from '@/update/cliUpdate';

describe('compareVersions', () => {
    it('orders releases and pre-releases', () => {
        expect(compareVersions('0.12.1', '0.12.0')).toBe(1);
        expect(compareVersions('0.12.0', '0.12.0')).toBe(0);
        expect(compareVersions('0.9.9', '0.12.0')).toBe(-1);
        expect(compareVersions('0.12.0-1', '0.12.0')).toBe(-1);
        expect(compareVersions('0.12.0', '0.12.0-1')).toBe(1);
    });
});

describe('startCliAutoUpdate', () => {
    let activity: MachineActivity;
    let statuses: CliUpdateStatus[];
    let updater: ReturnType<typeof startCliAutoUpdate> | null;

    const start = () => {
        updater = startCliAutoUpdate({ getActivity: () => activity, reportStatus: (s) => statuses.push(s) });
    };
    const last = () => statuses[statuses.length - 1];

    beforeEach(() => {
        vi.useFakeTimers();
        Object.assign(env, {
            latest: '0.13.0', installedAfter: '0.13.0', installError: null,
            support: { supported: true, packageManager: 'npm', sudo: false }, settings: {}, installs: 0, installedWithSudo: [],
        });
        activity = { sessions: 0, terminals: 0, executions: 0 };
        statuses = [];
        updater = null;
    });

    afterEach(() => {
        updater?.stop();
        vi.useRealTimers();
    });

    it('installs a newer version a few minutes after start when idle', async () => {
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(env.installs).toBe(0);
        // Nothing to say before the first check
        expect(statuses).toEqual([]);
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(env.installs).toBe(1);
        expect(last()).toMatchObject({ state: 'installed', latestVersion: '0.13.0' });
    });

    it('waits for sessions for at most a day', async () => {
        activity.sessions = 2;
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(env.installs).toBe(0);
        expect(last()).toMatchObject({ state: 'available', waitingFor: 'sessions' });
        await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
        expect(env.installs).toBe(1);
    });

    it('never interrupts orchestrator executions or terminals', async () => {
        activity = { sessions: 0, terminals: 1, executions: 1 };
        start();
        await vi.advanceTimersByTimeAsync(25 * 60 * 60_000);
        expect(env.installs).toBe(0);
        expect(last()).toMatchObject({ state: 'available', waitingFor: 'executions' });
    });

    it('only reports when turned off, and still installs when asked', async () => {
        env.settings = { autoUpdateDisabled: true };
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(env.installs).toBe(0);
        expect(last()).toMatchObject({ state: 'disabled', latestVersion: '0.13.0' });

        activity.terminals = 1;
        await expect(updater!.updateNow()).resolves.toMatchObject({ status: 'started' });
        await vi.advanceTimersByTimeAsync(0);
        expect(env.installs).toBe(1);
    });

    it('installs through sudo when that is how the install dir can be reached', async () => {
        env.support = { supported: true, packageManager: 'npm', sudo: true };
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(env.installedWithSudo).toEqual([true]);
        expect(last()).toMatchObject({ state: 'installed' });
    });

    it('reports an installation it cannot upgrade', async () => {
        env.support = { supported: false, reason: 'no-permission' };
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(last()).toMatchObject({ state: 'unsupported', reason: 'no-permission' });
        await expect(updater!.updateNow()).resolves.toMatchObject({ status: 'unsupported', reason: 'no-permission' });
        expect(env.installs).toBe(0);
    });

    it('leaves a failed version alone for a day', async () => {
        env.installError = 'EACCES';
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(env.installs).toBe(1);
        expect(last()).toMatchObject({ state: 'failed', error: 'EACCES' });
        await vi.advanceTimersByTimeAsync(12 * 60 * 60_000);
        expect(env.installs).toBe(1);
        await vi.advanceTimersByTimeAsync(13 * 60 * 60_000);
        expect(env.installs).toBe(2);
    });

    it('treats an install that left the old version on disk as failed', async () => {
        env.installedAfter = '0.12.0';
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(last()).toMatchObject({ state: 'failed' });
    });

    it('stays put when already on the latest version', async () => {
        env.latest = '0.12.0';
        start();
        await vi.advanceTimersByTimeAsync(6 * 60_000);
        expect(env.installs).toBe(0);
        expect(last()).toMatchObject({ state: 'up-to-date', latestVersion: '0.12.0' });
        await expect(updater!.updateNow()).resolves.toMatchObject({ status: 'up-to-date' });
    });
});
