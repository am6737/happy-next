import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    check: vi.fn(),
    getVersion: vi.fn(),
    install: vi.fn(),
    invoke: vi.fn(),
    relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('@/utils/tauri', () => ({ isTauriDesktop: () => true }));

describe('desktop updater state', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.getVersion.mockResolvedValue('2.0.0');
        mocks.invoke.mockResolvedValue({
            identifier: 'com.hitosea.happy',
            buildProfile: 'release',
        });
    });

    it('reports when the production client is current', async () => {
        mocks.check.mockResolvedValue(null);
        const updater = await import('./desktopUpdater');

        await expect(updater.checkForDesktopUpdate()).resolves.toMatchObject({
            phase: 'upToDate',
            currentVersion: '2.0.0',
        });
    });

    it('silently prepares, installs, and relaunches a verified update', async () => {
        const update = {
            currentVersion: '2.0.0',
            version: '2.1.0',
            body: 'Release notes',
            date: '2026-07-23T00:00:00Z',
            close: vi.fn().mockResolvedValue(undefined),
            download: vi.fn(async (onEvent: (event: any) => void) => {
                onEvent({ event: 'Started', data: { contentLength: 100 } });
                onEvent({ event: 'Progress', data: { chunkLength: 40 } });
                onEvent({ event: 'Finished' });
            }),
            install: mocks.install.mockResolvedValue(undefined),
        };
        mocks.check.mockResolvedValue(update);
        mocks.relaunch.mockResolvedValue(undefined);
        const updater = await import('./desktopUpdater');

        await expect(updater.prepareDesktopUpdate()).resolves.toMatchObject({
            phase: 'downloaded',
            availableVersion: '2.1.0',
            downloadedBytes: 100,
            totalBytes: 100,
        });
        expect(mocks.check).toHaveBeenCalledOnce();
        expect(update.download).toHaveBeenCalledOnce();
        await updater.installDesktopUpdateAndRelaunch();

        expect(update.install).toHaveBeenCalledOnce();
        expect(mocks.relaunch).toHaveBeenCalledOnce();
    });

    it('keeps a downloaded update available when installation fails', async () => {
        const update = {
            currentVersion: '2.0.0',
            version: '2.1.0',
            body: '',
            date: '2026-07-23T00:00:00Z',
            close: vi.fn().mockResolvedValue(undefined),
            download: vi.fn().mockResolvedValue(undefined),
            install: mocks.install
                .mockRejectedValueOnce(new Error('install failed'))
                .mockResolvedValueOnce(undefined),
        };
        mocks.check.mockResolvedValue(update);
        mocks.relaunch.mockResolvedValue(undefined);
        const updater = await import('./desktopUpdater');

        await updater.prepareDesktopUpdate();
        await expect(updater.installDesktopUpdateAndRelaunch()).resolves.toMatchObject({
            phase: 'installError',
            error: 'install failed',
        });
        expect(mocks.relaunch).not.toHaveBeenCalled();

        await updater.installDesktopUpdateAndRelaunch();
        expect(update.install).toHaveBeenCalledTimes(2);
        expect(mocks.relaunch).toHaveBeenCalledOnce();
    });
});
