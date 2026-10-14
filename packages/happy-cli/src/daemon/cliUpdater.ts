/**
 * CLI updates: checked automatically, installed only when asked.
 *
 * The daemon looks up the latest published CLI (through the machine's own npm
 * registry) a few minutes after it starts and about every hour after that, and
 * whenever the app asks (opening the machine page, switching to the machine,
 * or the "check" button) with a maximum age, judged against this clock.
 * The result is reported in `daemonState.cliUpdate`; the app compares it with
 * the running version to offer the update.
 *
 * The install only runs from the app (`updateNow`), after it has shown what a
 * restart interrupts (`preflight`). Once the new version is on disk the daemon
 * hands over to it right away through `onInstalled`; the heartbeat in run.ts
 * does the same for installs done outside the daemon (`happy update`).
 *
 * A global npm install the daemon's user cannot write is upgraded through
 * `sudo -n` when that needs no password (off with `autoUpdateNoSudo`).
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
    getUpgradeCommand,
    installLatest,
    readInstalledVersion,
    type AutoUpdateSupport,
} from '@/update/cliUpdate';

const FIRST_CHECK_MIN_DELAY_MS = 60_000;
const FIRST_CHECK_JITTER_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
const CHECK_JITTER_MS = 10 * 60_000;
const FAILED_CHECK_RETRY_MS = 30 * 60_000;
// How fresh the latest version must be for the preflight
const PREFLIGHT_MAX_AGE_MS = 10 * 60_000;

/** What a restart of the daemon would interrupt */
export type MachineActivity = {
    sessions: number;
    /** Terminals that close with the daemon (none when they live in tmux) */
    terminals: number;
    executions: number;
};

export type UpdateNowResult = {
    status: 'started' | 'up-to-date' | 'busy' | 'unsupported' | 'check-failed';
    reason?: string;
    latestVersion?: string;
};

export type CheckResult = {
    latestVersion: string | null;
    checkedAt?: number;
};

export type CliUpdatePreflight = {
    currentVersion: string;
    latestVersion: string | null;
    checkedAt?: number;
    installing: boolean;
    support: AutoUpdateSupport;
    /** What to run on the machine when the daemon cannot install by itself */
    manualCommand: string;
    activity: MachineActivity;
};

type Phase =
    | { state: 'idle' }
    | { state: 'installing'; targetVersion: string }
    | { state: 'failed'; targetVersion: string; error: string };

export function startCliUpdater(options: {
    getActivity: () => MachineActivity;
    reportStatus: (status: CliUpdateStatus) => void;
    /** The new version is on disk: restart on it */
    onInstalled: () => void;
}) {
    const currentVersion = configuration.currentCliVersion;
    let latestVersion: string | null = null;
    let checkedAt: number | undefined;
    let phase: Phase = { state: 'idle' };
    // Set from an install request until its install fails (a successful one ends in a restart)
    let busy = false;
    let inflight: Promise<string | null> | null = null;
    let timer: NodeJS.Timeout | null = null;
    let lastReported = '';

    const publish = () => {
        const status: CliUpdateStatus = { ...phase, ...(latestVersion ? { latestVersion } : {}), ...(checkedAt ? { checkedAt } : {}) };
        const serialized = JSON.stringify(status);
        if (serialized === lastReported) return;
        lastReported = serialized;
        logger.debug(`[CLI UPDATE] ${serialized}`);
        options.reportStatus(status);
    };

    const schedule = (delayMs: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void check(0), delayMs);
        timer.unref();
    };

    /** Latest published version, looked up again unless the last lookup is at most `maxAgeMs` old */
    const check = (maxAgeMs: number): Promise<string | null> => {
        if (latestVersion && checkedAt && Date.now() - checkedAt <= maxAgeMs) {
            return Promise.resolve(latestVersion);
        }
        inflight ??= fetchLatestVersion().then((fetched) => {
            schedule(fetched ? CHECK_INTERVAL_MS + Math.random() * CHECK_JITTER_MS : FAILED_CHECK_RETRY_MS);
            if (fetched) {
                latestVersion = fetched;
                checkedAt = Date.now();
                publish();
            }
            return fetched;
        }).finally(() => {
            inflight = null;
        });
        return inflight;
    };

    // Recomputed every time: sudo rights and the install location can change while the daemon runs
    const getSupport = async () => checkAutoUpdateSupport({ allowSudo: (await readSettings()).autoUpdateNoSudo !== true });

    const install = async (targetVersion: string, support: Extract<AutoUpdateSupport, { supported: true }>, release: () => Promise<void>) => {
        try {
            await installLatest(support.packageManager, support.sudo);
            const installedVersion = await readInstalledVersion();
            if (!installedVersion || compareVersions(installedVersion, currentVersion) <= 0) {
                throw new Error(`Install finished but the CLI is still on ${installedVersion ?? currentVersion}`);
            }
        } catch (error) {
            phase = { state: 'failed', targetVersion, error: error instanceof Error ? error.message : String(error) };
            busy = false;
            publish();
            return;
        } finally {
            await release();
        }
        logger.debug(`[CLI UPDATE] Installed ${targetVersion}, handing over`);
        options.onInstalled();
    };

    // A fresh daemon has nothing in progress: clear whatever the previous one left behind
    publish();
    schedule(FIRST_CHECK_MIN_DELAY_MS + Math.random() * FIRST_CHECK_JITTER_MS);

    return {
        check: async (maxAgeMs: number): Promise<CheckResult> => {
            const fetched = await check(maxAgeMs);
            return { latestVersion: fetched, checkedAt };
        },
        preflight: async (): Promise<CliUpdatePreflight> => {
            const [fetched, support] = await Promise.all([check(PREFLIGHT_MAX_AGE_MS), getSupport()]);
            return {
                currentVersion,
                latestVersion: fetched,
                checkedAt,
                installing: phase.state === 'installing',
                support,
                manualCommand: support.supported || support.reason === 'no-permission'
                    ? 'happy update'
                    : getUpgradeCommand('npm').join(' '),
                activity: options.getActivity(),
            };
        },
        /** Install the latest version now; the daemon then restarts on it */
        updateNow: async (): Promise<UpdateNowResult> => {
            if (busy) {
                return { status: 'busy' };
            }
            // Claimed before the first await, so a second request sees it
            busy = true;
            try {
                const support = await getSupport();
                if (!support.supported) {
                    return { status: 'unsupported', reason: support.reason };
                }
                const fetched = await check(0);
                if (!fetched) {
                    return { status: 'check-failed' };
                }
                if (compareVersions(fetched, currentVersion) <= 0) {
                    return { status: 'up-to-date', latestVersion: fetched };
                }
                const release = await acquireUpdateLock();
                if (!release) {
                    return { status: 'busy' };
                }
                phase = { state: 'installing', targetVersion: fetched };
                publish();
                void install(fetched, support, release);
                return { status: 'started', latestVersion: fetched };
            } finally {
                busy = phase.state === 'installing';
            }
        },
        stop: () => {
            if (timer) clearTimeout(timer);
        },
    };
}
