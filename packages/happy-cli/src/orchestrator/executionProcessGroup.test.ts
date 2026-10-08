import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EXECUTION_PROCESS_MARKER, ExecutionProcessGroup } from './executionProcessGroup';

const exit = (child: ReturnType<typeof spawn>) => new Promise<void>((resolve) => child.once('exit', () => resolve()));
const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Owned process group did not reach the expected state');
};

describe.skipIf(process.platform !== 'linux')('isolated execution process groups', () => {
  it.each([false, true])('reaps a derived child when detached=%s', async (detachedChild) => {
    const marker = randomUUID();
    const child = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const env = { ...process.env };
      if (!${detachedChild}) delete env.${EXECUTION_PROCESS_MARKER};
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
        { detached: ${detachedChild}, env, stdio: 'ignore' }).unref();
      setTimeout(() => process.exit(0), 50);
    `], { detached: true, stdio: 'ignore', env: { ...process.env, [EXECUTION_PROCESS_MARKER]: marker } });
    const group = new ExecutionProcessGroup(child, marker);
    await exit(child);
    await waitFor(() => group.hasLiveMembers());
    expect(await group.settle(100)).toEqual({ exited: true, lingered: true });
    expect(group.hasLiveMembers()).toBe(false);
  });

  it('kills a descendant after its launcher exits without touching another group', async () => {
    const spawnGroup = () => {
      const marker = randomUUID();
      const child = spawn(process.execPath, ['-e', `
        const { spawn } = require('node:child_process');
        spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
          { stdio: 'ignore' }).unref();
        setTimeout(() => process.exit(0), 30);
      `], { detached: true, stdio: 'ignore', env: { ...process.env,
        [EXECUTION_PROCESS_MARKER]: marker } });
      return { child, group: new ExecutionProcessGroup(child, marker) };
    };
    const first = spawnGroup();
    const second = spawnGroup();
    try {
      await Promise.all([exit(first.child), exit(second.child)]);
      await waitFor(() => first.group.hasLiveMembers() && second.group.hasLiveMembers());
      const settled = await first.group.settle(100);
      expect(settled).toEqual({ exited: true, lingered: true });
      expect(second.group.hasLiveMembers()).toBe(true);
    } finally {
      await Promise.all([first.group.settle(100), second.group.settle(100)]);
    }
    expect(second.group.hasLiveMembers()).toBe(false);
  });

  it('does not treat a normally exited process as a lingering group', async () => {
    const marker = randomUUID();
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      detached: true, stdio: 'ignore', env: { ...process.env,
        [EXECUTION_PROCESS_MARKER]: marker } });
    const group = new ExecutionProcessGroup(child, marker);
    await exit(child);
    expect(await group.settle(100)).toEqual({ exited: true, lingered: false });
  });
});
