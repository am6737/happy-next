import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
    execFile: (_command: string, args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
        const values: Record<string, string> = {
            prefix: '/usr\n',
            userconfig: '/home/coder/.npmrc\n',
            registry: 'https://registry.npmmirror.com/\n',
        };
        callback(null, values[args[2]] ?? '', '');
    },
}));

import { getInstallCommand } from './cliUpdate';

describe('getInstallCommand', () => {
    it('runs the plain upgrade without sudo', async () => {
        await expect(getInstallCommand('npm')).resolves.toEqual(['npm', 'install', '-g', 'happy-next-cli@latest']);
    });

    it('carries the user npm setup over to sudo', async () => {
        const command = await getInstallCommand('npm', 'no-prompt');
        expect(command.slice(0, 4)).toEqual(['sudo', '-n', 'env', `PATH=${process.env.PATH ?? ''}`]);
        expect(command.slice(4)).toEqual([
            'npm', 'install', '-g', 'happy-next-cli@latest',
            '--prefix', '/usr',
            '--userconfig', '/home/coder/.npmrc',
            '--registry', 'https://registry.npmmirror.com/',
        ]);
        expect(await getInstallCommand('npm', 'prompt')).not.toContain('-n');
    });

    it('never wraps pnpm or yarn in sudo', async () => {
        await expect(getInstallCommand('pnpm', 'no-prompt')).resolves.toEqual(['pnpm', 'add', '-g', 'happy-next-cli@latest']);
    });
});
