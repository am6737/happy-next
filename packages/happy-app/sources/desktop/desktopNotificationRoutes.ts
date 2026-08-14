const DESKTOP_NOTIFICATION_ROUTES_KEY = 'desktop-notification-routes-v1';
const MAX_PERSISTED_ROUTES = 256;

type DesktopNotificationRoute = {
    sessionId: string;
    savedAt: number;
};

type DesktopNotificationRouteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): DesktopNotificationRouteStorage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
}

function readRoutes(storage: DesktopNotificationRouteStorage): Record<string, DesktopNotificationRoute> {
    try {
        const raw = storage.getItem(DESKTOP_NOTIFICATION_ROUTES_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        const routes: Record<string, DesktopNotificationRoute> = {};
        for (const [id, value] of Object.entries(parsed)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                continue;
            }
            const route = value as Record<string, unknown>;
            if (typeof route.sessionId === 'string' && typeof route.savedAt === 'number') {
                routes[id] = { sessionId: route.sessionId, savedAt: route.savedAt };
            }
        }
        return routes;
    } catch {
        return {};
    }
}

export function rememberDesktopNotificationRoute(
    notificationId: number,
    sessionId: string,
    storage: DesktopNotificationRouteStorage | null = defaultStorage(),
): void {
    if (!storage) {
        return;
    }

    const routes = readRoutes(storage);
    routes[String(notificationId)] = { sessionId, savedAt: Date.now() };
    const entries = Object.entries(routes)
        .sort(([, left], [, right]) => right.savedAt - left.savedAt)
        .slice(0, MAX_PERSISTED_ROUTES);
    try {
        storage.setItem(DESKTOP_NOTIFICATION_ROUTES_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // Notifications should still be delivered when persistent storage is unavailable.
    }
}

export function resolveDesktopNotificationRoute(
    notificationId: number,
    storage: DesktopNotificationRouteStorage | null = defaultStorage(),
): string | null {
    if (!storage) {
        return null;
    }
    return readRoutes(storage)[String(notificationId)]?.sessionId ?? null;
}

export function clearDesktopNotificationRoutes(
    storage: DesktopNotificationRouteStorage | null = defaultStorage(),
): void {
    try {
        storage?.removeItem(DESKTOP_NOTIFICATION_ROUTES_KEY);
    } catch {
        // Ignore storage failures during sign-out.
    }
}
