import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliUpdateStatus } from '@/api/types';

const env = vi.hoisted(() => ({
    latest: '0.13.0' as string | null,
    installedAfter: '0.13.0',
    installError: null as string | null,
    support: { supported: true, packageManager: 'npm', sudo: false } as any,
    lockFree: true,
    fetches: 0,
    installs: 0,
    installedWithSudo: [] as boolean[],
}));

vi.mock('@/configuration', () => ({ configuration: { currentCliVersion: '0.12.0' } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/persistence', () => ({ readSettings: async () => ({}) }));
vi.mock('@/update/cliUpdate', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/update/cliUpdate')>();
    return {
        compareVersions: original.compareVersions,
        getUpgradeCommand: original.getUpgradeCommand,
        fetchLatestVersion: async () => {
            env.fetches++;
            return env.latest;
        },
        checkAutoUpdateSupport: async () => env.support,
        acquireUpdateLock: async () => env.lockFree ? async () => {} : null,
        readInstalledVersion: async () => env.installedAfter,
        installLatest: async (_pm: string, sudo: boolean) => {
            env.installs++;
            env.installedWithSudo.push(sudo);
            if (env.installError) throw new Error(env.installError);
        },
    };
});

import { startCliUpdater, type MachineActivity } from './cliUpdater';
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

describe('startCliUpdater', () => {
    let activity: MachineActivity;
    let statuses: CliUpdateStatus[];
    let installed: number;
    let updater: ReturnType<typeof startCliUpdater> | null;

    const start = () => {
        updater = startCliUpdater({
            getActivity: () => activity,
            reportStatus: (s) => statuses.push(s),
            onInstalled: () => installed++,
        });
        return updater;
    };
    const last = () => statuses[statuses.length - 1];

    beforeEach(() => {
        vi.useFakeTimers();
        Object.assign(env, {
            latest: '0.13.0', installedAfter: '0.13.0', installError: null,
            support: { supported: true, packageManager: 'npm', sudo: false }, lockFree: true,
            fetches: 0, installs: 0, installedWithSudo: [],
        });
        activity = { sessions: 0, terminals: 0, executions: 0 };
        statuses = [];
        installed = 0;
        updater = null;
    });

    afterEach(() => {
        updater?.stop();
        vi.useRealTimers();
    });

    it('clears the previous state on start and checks within three minutes, then hourly', async () => {
        start();
        expect(statuses).toEqual([{ state: 'idle' }]);
        await vi.advanceTimersByTimeAsync(3 * 60_000);
        expect(env.fetches).toBe(1);
        expect(last()).toMatchObject({ state: 'idle', latestVersion: '0.13.0' });
        await vi.advanceTimersByTimeAsync(71 * 60_000);
        expect(env.fetches).toBe(2);
        // Never installs by itself
        expect(env.installs).toBe(0);
    });

    it('only checks again when the last check is older than asked', async () => {
        const updater = start();
        await updater.check(10 * 60_000);
        expect(env.fetches).toBe(1);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await expect(updater.check(10 * 60_000)).resolves.toMatchObject({ latestVersion: '0.13.0' });
        expect(env.fetches).toBe(1);
        await updater.check(0);
        expect(env.fetches).toBe(2);
    });

    it('shares one lookup between concurrent checks', async () => {
        const updater = start();
        await Promise.all([updater.check(0), updater.check(0)]);
        expect(env.fetches).toBe(1);
    });

    it('describes what an update involves', async () => {
        activity = { sessions: 2, terminals: 1, executions: 1 };
        await expect(start().preflight()).resolves.toMatchObject({
            currentVersion: '0.12.0',
            latestVersion: '0.13.0',
            installing: false,
            support: { supported: true },
            manualCommand: 'happy update',
            activity,
        });
    });

    it('installs when asked, whatever is running, and hands over', async () => {
        activity = { sessions: 1, terminals: 1, executions: 1 };
        const updater = start();
        await expect(updater.updateNow()).resolves.toMatchObject({ status: 'started', latestVersion: '0.13.0' });
        expect(last()).toMatchObject({ state: 'installing', targetVersion: '0.13.0' });
        await expect(updater.updateNow()).resolves.toMatchObject({ status: 'busy' });
        await vi.advanceTimersByTimeAsync(0);
        expect(env.installs).toBe(1);
        expect(installed).toBe(1);
    });

    it('turns away a second request made while the first one is still checking', async () => {
        const updater = start();
        const [first, second] = await Promise.all([updater.updateNow(), updater.updateNow()]);
        expect(first.status).toBe('started');
        expect(second.status).toBe('busy');
    });

    it('installs through sudo when that is how the install dir can be reached', async () => {
        env.support = { supported: true, packageManager: 'npm', sudo: true };
        await start().updateNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(env.installedWithSudo).toEqual([true]);
    });

    it('refuses an installation it cannot upgrade', async () => {
        env.support = { supported: false, reason: 'no-permission' };
        const updater = start();
        await expect(updater.updateNow()).resolves.toMatchObject({ status: 'unsupported', reason: 'no-permission' });
        await expect(updater.preflight()).resolves.toMatchObject({ manualCommand: 'happy update' });
        expect(env.installs).toBe(0);
    });

    it('reports another upgrade holding the lock as busy', async () => {
        env.lockFree = false;
        await expect(start().updateNow()).resolves.toMatchObject({ status: 'busy' });
        expect(last()).toMatchObject({ state: 'idle' });
    });

    it('reports a failed install and lets it be retried', async () => {
        env.installError = 'EACCES';
        const updater = start();
        await updater.updateNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(last()).toMatchObject({ state: 'failed', targetVersion: '0.13.0', error: 'EACCES' });
        expect(installed).toBe(0);

        env.installError = null;
        await expect(updater.updateNow()).resolves.toMatchObject({ status: 'started' });
        await vi.advanceTimersByTimeAsync(0);
        expect(installed).toBe(1);
    });

    it('treats an install that left the old version on disk as failed', async () => {
        env.installedAfter = '0.12.0';
        await start().updateNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(last()).toMatchObject({ state: 'failed' });
        expect(installed).toBe(0);
    });

    it('does nothing when already on the latest version', async () => {
        env.latest = '0.12.0';
        await expect(start().updateNow()).resolves.toMatchObject({ status: 'up-to-date' });
        expect(env.installs).toBe(0);
    });
});
