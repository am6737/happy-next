import { getShareExtensionKey } from 'expo-share-intent';

/**
 * The iOS share extension opens the app with `<scheme>://dataUrl=<key>`, which is no route: the
 * app stays where it is, and ShareIntentReceiver takes what was shared to where it goes.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
    try {
        if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return null;
    } catch {
        // Not a share: the link goes where it says
    }
    return path;
}
