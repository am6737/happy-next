import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    isDesktop: { value: true },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauri', () => ({ isTauriDesktop: () => mocks.isDesktop.value }));

describe('local machine ids', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.isDesktop.value = true;
    });

    it('holds the ids the CLI on this computer is registered under', async () => {
        mocks.invoke.mockResolvedValue(['machine-1', 'machine-2']);
        const local = await import('./desktopLocalMachine');

        await local.loadLocalMachineIds();

        expect(mocks.invoke).toHaveBeenCalledWith('get_desktop_local_machine_ids');
        expect([...local.getLocalMachineIds()]).toEqual(['machine-1', 'machine-2']);
    });

    it('reads them once, however many rows ask', async () => {
        mocks.invoke.mockResolvedValue(['machine-1']);
        const local = await import('./desktopLocalMachine');

        await Promise.all([local.loadLocalMachineIds(), local.loadLocalMachineIds()]);
        await local.loadLocalMachineIds();

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });

    it('tells its subscribers once the ids arrive', async () => {
        mocks.invoke.mockResolvedValue(['machine-1']);
        const local = await import('./desktopLocalMachine');
        const listener = vi.fn();
        local.subscribeToLocalMachineIds(listener);

        await local.loadLocalMachineIds();

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stays empty when the ids cannot be read', async () => {
        mocks.invoke.mockRejectedValue(new Error('unreadable'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const local = await import('./desktopLocalMachine');

        await local.loadLocalMachineIds();

        expect(local.getLocalMachineIds().size).toBe(0);
        warn.mockRestore();
    });

    it('asks nothing where there is no file manager to reveal into', async () => {
        mocks.isDesktop.value = false;
        const local = await import('./desktopLocalMachine');

        await local.loadLocalMachineIds();

        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(local.getLocalMachineIds().size).toBe(0);
    });
});
