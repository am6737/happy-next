import * as React from 'react';
import { useRouter } from 'expo-router';

/**
 * Returns to the home screen from anywhere in the stack, so the session list is read on its own.
 *
 * Archiving needs it: the archived row leaves the list, but the screen the router pushed for that
 * session is still on the stack, leaving the list behind a session that is no longer there.
 * `session/[id]/info` dismisses after archiving the same way.
 */
export function useDismissToHome() {
    const router = useRouter();
    return React.useCallback(() => {
        // On the home screen itself there is nothing to pop. `dismissAll` is a no-op there, but
        // React Navigation still reports the unhandled `POP_TO_TOP` in development.
        if (!router.canDismiss()) return;
        router.dismissAll();
    }, [router]);
}
