import { getShareExtensionKey } from 'expo-share-intent';

/**
 * The iOS share extension opens the app with `<scheme>://dataUrl=<key>`, which is no route: it
 * leads to the share-target page, where ShareIntentReceiver hands over what was shared.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
    try {
        if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/share-target';
    } catch {
        // Not a share: the link goes where it says
    }
    return path;
}
