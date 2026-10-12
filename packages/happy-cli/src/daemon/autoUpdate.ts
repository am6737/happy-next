/**
 * CLI auto-update
 *
 * The daemon checks for a newer published CLI a few minutes after it starts
 * and about every hour after that, and installs it with the package manager the
 * CLI was installed with. It does not restart itself: the heartbeat in run.ts
 * sees the new package.json and hands over to a daemon on the new version.
 *
 * Restarting the daemon kills its terminals and orchestrator executions, and
 * the new daemon no longer tracks the sessions already running (they keep
 * running). So an update waits until the machine is idle: terminals and
 * executions always hold it back, running sessions only for up to a day.
 *
 * Turned off by HAPPY_DISABLE_AUTO_UPDATE or `autoUpdateDisabled` in
 * settings.json; the app can still trigger an update through `updateNow`.
 */

import { configuration } from '@/configuration';
import { readSettings } from '@/persistence';
import { logger } from '@/ui/logger';
import type { CliUpdateStatus } from '@/api/types';
import {
    acquireUpdateLock,
    checkAutoUpdateSupport,
    compareVersions,
    fetchLatestVersion,
    installLatest,
    readInstalledVersion,
} from '@/update/cliUpdate';

const TICK_MS = 60_000;
const FIRST_CHECK_DELAY_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
const CHECK_JITTER_MS = 10 * 60_000;
const FAILED_CHECK_RETRY_MS = 30 * 60_000;
// How long running sessions may hold back an update
const MAX_SESSION_DEFERRAL_MS = 24 * 60 * 60_000;
// How long a failed version is left alone before trying it again
const FAILED_VERSION_BACKOFF_MS = 24 * 60 * 60_000;

export type MachineActivity = {
    sessions: number;
    terminals: number;
    executions: number;
};

export type UpdateNowResult = {
    status: 'started' | 'up-to-date' | 'busy' | 'unsupported' | 'check-failed';
    reason?: string;
    latestVersion?: string;
};

export function startCliAutoUpdate(options: {
    getActivity: () => MachineActivity;
    reportStatus: (status: CliUpdateStatus) => void;
}) {
    const currentVersion = configuration.currentCliVersion;
    let latestVersion: string | null = null;
    let checkedAt: number | undefined;
    let nextCheckAt = Date.now() + FIRST_CHECK_DELAY_MS + Math.random() * 3 * 60_000;
    let pendingSince: number | null = null;
    let failure: { version: string; at: number; error: string } | null = null;
    let installing = false;
    let installed = false;
    let ticking = false;
    let lastReported = '';
    // Where and how the CLI is installed does not change while the daemon runs
    const support = checkAutoUpdateSupport();

    const report = (status: CliUpdateStatus) => {
        const serialized = JSON.stringify(status);
        if (serialized === lastReported) return;
        lastReported = serialized;
        logger.debug(`[AUTO UPDATE] ${serialized}`);
        options.reportStatus(status);
    };

    const check = async () => {
        const fetched = await fetchLatestVersion();
        nextCheckAt = Date.now() + (fetched ? CHECK_INTERVAL_MS + Math.random() * CHECK_JITTER_MS : FAILED_CHECK_RETRY_MS);
        if (fetched) {
            latestVersion = fetched;
            checkedAt = Date.now();
        }
        return fetched;
    };

    const install = async (targetVersion: string) => {
        installing = true;
        report({ state: 'installing', latestVersion: targetVersion, checkedAt });
        const release = await acquireUpdateLock();
        if (!release) {
            installing = false;
            report({ state: 'available', waitingFor: 'other-update', latestVersion: targetVersion, checkedAt });
            return;
        }
        try {
            const installation = await support;
            if (!installation.supported) {
                throw new Error(installation.reason);
            }
            await installLatest(installation.packageManager);
            const installedVersion = await readInstalledVersion();
            if (!installedVersion || installedVersion === currentVersion) {
                throw new Error(`Install finished but the CLI is still on ${currentVersion}`);
            }
            installed = true;
            report({ state: 'installed', latestVersion: installedVersion, checkedAt });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failure = { version: targetVersion, at: Date.now(), error: message };
            report({ state: 'failed', latestVersion: targetVersion, error: message, checkedAt });
        } finally {
            installing = false;
            await release();
        }
    };

    const tick = async () => {
        if (ticking || installing || installed) return;
        ticking = true;
        try {
            if (Date.now() >= nextCheckAt) {
                await check();
            }

            const autoDisabled = configuration.disableAutoUpdate || (await readSettings()).autoUpdateDisabled === true;
            const installation = await support;
            const latest = latestVersion ?? undefined;
            if (!installation.supported) {
                report({ state: 'unsupported', reason: installation.reason, latestVersion: latest, checkedAt });
                return;
            }
            if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
                pendingSince = null;
                report({ state: autoDisabled ? 'disabled' : 'up-to-date', latestVersion: latest, checkedAt });
                return;
            }
            if (autoDisabled) {
                report({ state: 'disabled', latestVersion, checkedAt });
                return;
            }
            if (failure && failure.version === latestVersion && Date.now() - failure.at < FAILED_VERSION_BACKOFF_MS) {
                report({ state: 'failed', latestVersion, error: failure.error, checkedAt });
                return;
            }

            pendingSince ??= Date.now();
            const installBy = pendingSince + MAX_SESSION_DEFERRAL_MS;
            const activity = options.getActivity();
            const waitingFor = activity.executions > 0 ? 'executions'
                : activity.terminals > 0 ? 'terminals'
                : activity.sessions > 0 && Date.now() < installBy ? 'sessions'
                : null;
            if (waitingFor) {
                report({ state: 'available', waitingFor, latestVersion, checkedAt, installBy });
                return;
            }
            await install(latestVersion);
        } catch (error) {
            logger.debug('[AUTO UPDATE] Tick failed', error);
        } finally {
            ticking = false;
        }
    };

    const interval = setInterval(() => void tick(), TICK_MS);
    interval.unref();
    void tick();

    return {
        /** Install the latest version right away, whatever is running (asked for from the app). */
        updateNow: async (): Promise<UpdateNowResult> => {
            if (installing || installed) {
                return { status: 'busy' };
            }
            const installation = await support;
            if (!installation.supported) {
                return { status: 'unsupported', reason: installation.reason };
            }
            const fetched = await check();
            if (!fetched) {
                return { status: 'check-failed' };
            }
            if (compareVersions(fetched, currentVersion) <= 0) {
                report({ state: 'up-to-date', latestVersion: fetched, checkedAt });
                return { status: 'up-to-date', latestVersion: fetched };
            }
            void install(fetched);
            return { status: 'started', latestVersion: fetched };
        },
        stop: () => clearInterval(interval),
    };
}
