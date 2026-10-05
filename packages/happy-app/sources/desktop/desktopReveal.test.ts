import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    isDesktop: { value: true },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/utils/tauri', () => ({ isTauriDesktop: () => mocks.isDesktop.value }));

import { getRevealLabelKey, revealItemInFileManager } from './desktopReveal';

describe('reveal in file manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isDesktop.value = true;
    });

    it('names the file manager each platform has', () => {
        expect(getRevealLabelKey('macos')).toBe('sessionInfo.revealInFinder');
        expect(getRevealLabelKey('windows')).toBe('sessionInfo.revealInFolder');
    });

    it('reveals a path through the opener plugin', async () => {
        await revealItemInFileManager('/Users/wei/project');

        expect(mocks.invoke).toHaveBeenCalledWith('plugin:opener|reveal_item_in_dir', {
            paths: ['/Users/wei/project'],
        });
    });

    it('refuses outside the desktop app', async () => {
        mocks.isDesktop.value = false;

        await expect(revealItemInFileManager('/Users/wei/project')).rejects.toThrow();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});
