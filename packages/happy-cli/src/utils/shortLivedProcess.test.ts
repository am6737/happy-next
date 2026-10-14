import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { withShortLivedProcess } from './shortLivedProcess';

const isAlive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

describe.skipIf(process.platform === 'win32')('withShortLivedProcess', () => {
    const options = { cwd: process.cwd(), env: process.env, timeoutMs: 5_000 };

    it('ends the process and what it started once run settles', async () => {
        // The shell starts a background sleep, prints its pid and waits on it
        const grandchild = await withShortLivedProcess('sh', ['-c', 'sleep 30 & echo $!; wait'], options, async (child) => {
            for await (const line of createInterface({ input: child.stdout })) return Number(line);
            throw new Error('no pid');
        });

        await expect.poll(() => isAlive(grandchild), { timeout: 3_000 }).toBe(false);
    });

    it('rejects when the timeout passes', async () => {
        await expect(withShortLivedProcess('sleep', ['30'], { ...options, timeoutMs: 100 }, () => new Promise(() => {})))
            .rejects.toThrow('Timed out waiting for sleep');
    });

    it('rejects when the process exits first', async () => {
        await expect(withShortLivedProcess('sh', ['-c', 'exit 3'], options, () => new Promise(() => {})))
            .rejects.toThrow('sh exited with code 3');
    });
});
