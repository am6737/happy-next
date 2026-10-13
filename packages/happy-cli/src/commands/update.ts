import chalk from 'chalk';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import packageJson from '../../package.json';
import { isDaemonRunningCurrentlyInstalledHappyVersion, startDaemonDetachedAndAwaitReady } from '@/daemon/controlClient';
import { readCredentials } from '@/persistence';
import { acquireUpdateLock, canWriteInstallDir, detectPackageManager, fetchLatestVersion, getInstallCommand } from '@/update/cliUpdate';

/**
 * When run as `sudo happy update`, HOME points at /root, so credentials and
 * daemon state would be looked up in root's happy dir. Returns the invoking
 * user so the daemon step can be handled for them instead.
 */
function getSudoInvokingUser(): string | null {
    const sudoUser = process.env.SUDO_USER;
    if (process.getuid?.() !== 0 || !sudoUser || sudoUser === 'root') {
        return null;
    }
    return sudoUser;
}

function readSudoUserDaemonVersion(user: string): string | null {
    try {
        // -H resolves the user's home dir from the passwd database
        const home = execFileSync('sudo', ['-u', user, '-H', 'sh', '-c', 'printf %s "$HOME"'], { encoding: 'utf-8' });
        const state = JSON.parse(readFileSync(join(home, '.happy-next', 'daemon.state.json'), 'utf-8'));
        process.kill(state.pid, 0);
        return typeof state.startedWithCliVersion === 'string' ? state.startedWithCliVersion : null;
    } catch {
        return null;
    }
}

/**
 * Never start the daemon from sudo: it would inherit sudo's reset environment
 * (secure_path PATH, no user env vars) and lose CLIs like ~/.local/bin/claude.
 * A running daemon restarts itself on version change and keeps its own env.
 */
function reportDaemonForSudoUser(user: string, version: string): void {
    const daemonVersion = readSudoUserDaemonVersion(user);
    if (daemonVersion === version) {
        return;
    }
    if (daemonVersion) {
        console.log(chalk.gray(`ℹ The daemon of user "${user}" will restart itself on v${version} within about a minute.`));
    } else {
        console.log(chalk.gray(`ℹ No daemon running for user "${user}". Run "happy daemon start" as "${user}" (without sudo) to start it.`));
    }
}

async function startDaemonWithFeedback(version: string): Promise<void> {
    // A detached daemon has no terminal to complete interactive auth,
    // so starting it requires prior login.
    const credentials = await readCredentials();
    if (!credentials) {
        console.log(chalk.gray('ℹ Not logged in — daemon not started. It will start automatically after you log in (run "happy" or "happy auth login").'));
        return;
    }

    console.log(`Starting daemon v${version}...`);
    try {
        const started = await startDaemonDetachedAndAwaitReady(version);
        if (started) {
            console.log(chalk.green(`✓ Daemon running (v${version})`));
        } else {
            console.log(chalk.yellow('⚠ Daemon did not confirm startup. Check "happy daemon status" or run "happy daemon start".'));
        }
    } catch (error) {
        console.log(chalk.yellow(`⚠ Failed to start daemon: ${error instanceof Error ? error.message : 'unknown error'}. Run "happy daemon start" manually.`));
    }
}

export async function handleUpdateCommand(): Promise<void> {
    const currentVersion = packageJson.version;

    // Query latest version
    console.log(chalk.gray('Checking for updates...'));
    const latestVersion = await fetchLatestVersion();

    if (!latestVersion) {
        console.error(chalk.red('Failed to check latest version. Please check your network connection.'));
        process.exit(1);
    }

    console.log(`Current version: ${chalk.cyan(currentVersion)}`);
    console.log(`Latest version:  ${chalk.cyan(latestVersion)}`);
    console.log('');

    if (currentVersion === latestVersion) {
        console.log(chalk.green('✓ Already up to date'));

        // No upgrade happened, but still make sure the daemon is up and
        // running this version. Silent when it already is.
        const sudoUser = getSudoInvokingUser();
        if (sudoUser) {
            reportDaemonForSudoUser(sudoUser, latestVersion);
        } else if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
            await startDaemonWithFeedback(latestVersion);
        }
        process.exit(0);
    }

    // Detect package manager and upgrade
    const pm = detectPackageManager();
    // A root-owned global npm dir: go through sudo here rather than having the user rerun with sudo
    const useSudo = pm === 'npm' && process.platform !== 'win32' && process.getuid?.() !== 0 && !(await canWriteInstallDir());
    const command = await getInstallCommand(pm, useSudo ? 'prompt' : undefined);
    const releaseLock = await acquireUpdateLock();
    if (!releaseLock) {
        console.error(chalk.yellow('⚠ Another upgrade is already running (likely the daemon updating itself). Try again in a few minutes.'));
        process.exit(1);
    }
    console.log(`Upgrading via ${chalk.bold(useSudo ? `sudo ${pm}` : pm)}...`);

    try {
        execFileSync(command[0], command.slice(1), { stdio: 'inherit' });
    } catch {
        await releaseLock();
        console.error(chalk.red(`\n✗ Upgrade failed. You can try manually:`));
        console.error(chalk.gray(`  ${command.join(' ')}`));
        process.exit(1);
    }
    await releaseLock();

    console.log(chalk.green(`\n✓ Upgraded to ${latestVersion}`));

    // Start the daemon on the new version. start-sync is idempotent and
    // takes over an old-version daemon by itself, so no pre-checks needed.
    const sudoUser = getSudoInvokingUser();
    if (sudoUser) {
        reportDaemonForSudoUser(sudoUser, latestVersion);
    } else {
        await startDaemonWithFeedback(latestVersion);
    }

    process.exit(0);
}
