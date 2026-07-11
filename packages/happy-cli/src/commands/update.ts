import chalk from 'chalk';
import { execSync, execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import packageJson from '../../package.json';
import { isDaemonRunningCurrentlyInstalledHappyVersion, startDaemonDetachedAndAwaitReady } from '@/daemon/controlClient';
import { readCredentials } from '@/persistence';

const PACKAGE_NAME = 'happy-next-cli';

type PackageManager = 'npm' | 'pnpm' | 'yarn';

function detectPackageManager(): PackageManager {
    try {
        const whichOutput = execSync('which happy', { encoding: 'utf-8' }).trim();
        const realPath = realpathSync(whichOutput);

        if (realPath.includes('/pnpm/') || realPath.includes('/pnpm-global/')) {
            return 'pnpm';
        }
        if (realPath.includes('/.yarn/') || realPath.includes('/yarn/')) {
            return 'yarn';
        }
    } catch {
        // Fall through to default
    }
    return 'npm';
}

function getUpgradeCommand(pm: PackageManager): string[] {
    switch (pm) {
        case 'pnpm':
            return ['pnpm', 'add', '-g', `${PACKAGE_NAME}@latest`];
        case 'yarn':
            return ['yarn', 'global', 'add', `${PACKAGE_NAME}@latest`];
        case 'npm':
            return ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`];
    }
}

function getLatestVersion(): string | null {
    try {
        return execFileSync('npm', ['view', PACKAGE_NAME, 'version'], { encoding: 'utf-8' }).trim();
    } catch {
        return null;
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
    const latestVersion = getLatestVersion();

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
        if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
            await startDaemonWithFeedback(latestVersion);
        }
        process.exit(0);
    }

    // Detect package manager and upgrade
    const pm = detectPackageManager();
    const command = getUpgradeCommand(pm);
    console.log(`Upgrading via ${chalk.bold(pm)}...`);

    try {
        execFileSync(command[0], command.slice(1), { stdio: 'inherit' });
    } catch {
        console.error(chalk.red(`\n✗ Upgrade failed. You can try manually:`));
        console.error(chalk.gray(`  ${command.join(' ')}`));
        process.exit(1);
    }

    console.log(chalk.green(`\n✓ Upgraded to ${latestVersion}`));

    // Start the daemon on the new version. start-sync is idempotent and
    // takes over an old-version daemon by itself, so no pre-checks needed.
    await startDaemonWithFeedback(latestVersion);

    process.exit(0);
}
