import { describe, expect, it } from 'vitest';

import { desktopKeyboardShortcutAction, desktopKeyboardShortcutLabel } from './desktopKeyboardShortcuts';

const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...modifiers,
});

describe('desktopKeyboardShortcutAction', () => {
    it('maps both standard search shortcuts', () => {
        expect(desktopKeyboardShortcutAction(event('k', { metaKey: true }), 'macos')).toBe('search');
        expect(desktopKeyboardShortcutAction(event('f', { ctrlKey: true }), 'windows')).toBe('search');
    });

    it('maps navigation and creation shortcuts', () => {
        expect(desktopKeyboardShortcutAction(event('n', { metaKey: true }), 'macos')).toBe('newSession');
        expect(desktopKeyboardShortcutAction(event('1', { ctrlKey: true }), 'windows')).toBe('sessions');
        expect(desktopKeyboardShortcutAction(event('2', { ctrlKey: true }), 'windows')).toBe('inbox');
        expect(desktopKeyboardShortcutAction(event('3', { ctrlKey: true }), 'windows')).toBe('dootask');
        expect(desktopKeyboardShortcutAction(event('4', { ctrlKey: true }), 'windows')).toBe('settings');
    });

    it('uses platform-native back and forward shortcuts', () => {
        expect(desktopKeyboardShortcutAction(event('[', { metaKey: true }), 'macos')).toBe('back');
        expect(desktopKeyboardShortcutAction(event(']', { metaKey: true }), 'macos')).toBe('forward');
        expect(desktopKeyboardShortcutAction(event('ArrowLeft', { altKey: true }), 'windows')).toBe('back');
        expect(desktopKeyboardShortcutAction(event('ArrowRight', { altKey: true }), 'windows')).toBe('forward');
    });

    it('does not accept the wrong primary modifier', () => {
        expect(desktopKeyboardShortcutAction(event('k', { ctrlKey: true }), 'macos')).toBeNull();
        expect(desktopKeyboardShortcutAction(event('k', { metaKey: true }), 'windows')).toBeNull();
    });
});

describe('desktopKeyboardShortcutLabel', () => {
    it('uses native-looking labels for each desktop platform', () => {
        expect(desktopKeyboardShortcutLabel('search', 'macos')).toBe('⌘K');
        expect(desktopKeyboardShortcutLabel('settings', 'macos')).toBe('⌘,');
        expect(desktopKeyboardShortcutLabel('newSession', 'windows')).toBe('Ctrl+N');
        expect(desktopKeyboardShortcutLabel('back', 'windows')).toBe('Alt+Left');
    });
});
