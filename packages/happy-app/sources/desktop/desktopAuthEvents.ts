type DesktopAuthenticationListener = (authenticated: boolean) => void;

const listeners = new Set<DesktopAuthenticationListener>();

export function publishDesktopAuthentication(authenticated: boolean) {
    for (const listener of listeners) {
        listener(authenticated);
    }
}

export function subscribeToDesktopAuthentication(listener: DesktopAuthenticationListener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
