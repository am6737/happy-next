import type { DesktopPlatform } from './desktopWindowUtils';

export type DesktopKeyboardShortcutAction =
    | 'search'
    | 'newSession'
    | 'settings'
    | 'sessions'
    | 'inbox'
    | 'dootask'
    | 'back'
    | 'forward';

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

export function desktopKeyboardShortcutAction(
    event: ShortcutEvent,
    platform: DesktopPlatform,
): DesktopKeyboardShortcutAction | null {
    const key = event.key.toLowerCase();
    const primaryModifier = platform === 'macos' ? event.metaKey : event.ctrlKey;

    if (primaryModifier && !event.altKey) {
        switch (key) {
            case 'k':
            case 'f':
                return 'search';
            case ',':
            case '4':
                return 'settings';
            case 'n':
                return 'newSession';
            case '1':
                return 'sessions';
            case '2':
                return 'inbox';
            case '3':
                return 'dootask';
            case '[':
                return platform === 'macos' ? 'back' : null;
            case ']':
                return platform === 'macos' ? 'forward' : null;
        }
    }

    if (platform === 'windows' && event.altKey && !event.metaKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') return 'back';
        if (event.key === 'ArrowRight') return 'forward';
    }

    return null;
}
