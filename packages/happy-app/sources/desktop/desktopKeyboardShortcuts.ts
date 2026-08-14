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

export function desktopKeyboardShortcutLabel(
    action: DesktopKeyboardShortcutAction,
    platform: DesktopPlatform,
): string {
    const primary = platform === 'macos' ? '⌘' : 'Ctrl+';

    switch (action) {
        case 'search':
            return `${primary}K`;
        case 'newSession':
            return `${primary}N`;
        case 'sessions':
            return `${primary}1`;
        case 'inbox':
            return `${primary}2`;
        case 'dootask':
            return `${primary}3`;
        case 'settings':
            return `${primary},`;
        case 'back':
            return platform === 'macos' ? '⌘[' : 'Alt+Left';
        case 'forward':
            return platform === 'macos' ? '⌘]' : 'Alt+Right';
    }
}

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
