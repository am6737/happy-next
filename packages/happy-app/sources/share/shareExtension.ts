import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ShareTarget } from './sharedContent';

/**
 * The iOS share extension's side of the App Group (modules/share-extension): the snapshot it
 * lists sessions from, and where the user sent the content from its sheet.
 */
const native = Platform.OS === 'ios'
    ? requireOptionalNativeModule<{
        setSnapshot(json: string | null): void;
        takeTarget(): string | null;
    }>('HappyShareExtension')
    : null;

export function setShareExtensionSnapshot(json: string | null) {
    native?.setSnapshot(json);
}

/** Where the extension's sheet sent what was shared, once; null when it opened the app without a pick. */
export function takeShareExtensionTarget(): ShareTarget | null {
    const target = native?.takeTarget() ?? null;
    if (target === 'new') return { type: 'new' };
    if (target?.startsWith('session:')) return { type: 'session', sessionId: target.slice('session:'.length) };
    return null;
}
