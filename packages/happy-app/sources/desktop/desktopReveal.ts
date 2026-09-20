import { invoke } from '@tauri-apps/api/core';
import { isTauriDesktop } from '@/utils/tauri';
import type { DesktopPlatform } from './desktopWindowUtils';

/**
 * The menu row says the name of the file manager the platform actually has: Finder on macOS, and
 * on Windows the shorter "show in folder" that does not spell out Explorer.
 */
export function getRevealLabelKey(
    platform: DesktopPlatform | null,
): 'sessionInfo.revealInFinder' | 'sessionInfo.revealInFolder' {
    return platform === 'windows' ? 'sessionInfo.revealInFolder' : 'sessionInfo.revealInFinder';
}

/** Opens the platform's file manager with `path` selected inside its parent folder. */
export async function revealItemInFileManager(path: string): Promise<void> {
    if (!isTauriDesktop()) {
        throw new Error('Revealing a path needs the desktop app');
    }
    await invoke('plugin:opener|reveal_item_in_dir', { paths: [path] });
}
