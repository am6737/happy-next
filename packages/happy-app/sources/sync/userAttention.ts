import { Platform } from 'react-native';

/**
 * How long after the last input the person still counts as at the screen. Same window as Element
 * Web's "active recently" (matrix-react-sdk `UserActivity`), which gates read receipts the same way.
 */
export const USER_IDLE_AFTER_MS = 2 * 60 * 1000;

export interface UserAttentionEnv {
    now(): number;
    /** The window is visible and holds focus. */
    isFocused(): boolean;
}

export interface UserAttention {
    /** Focused, and some input arrived within `USER_IDLE_AFTER_MS`. */
    isPresent(): boolean;
    recordActivity(): void;
    /**
     * Call when the window may have lost focus or visibility. Leaving ends presence outright, so
     * coming back always goes through an input and `onPresent`, even within the idle window.
     */
    recordLeave(): void;
    /** Fires when input brings the person back from not present. */
    onPresent(listener: () => void): () => void;
}

export function createUserAttention(env: UserAttentionEnv): UserAttention {
    // A window that starts focused (reload, fresh open) counts as just used.
    let lastActivityAt = env.isFocused() ? env.now() : -Infinity;
    const listeners = new Set<() => void>();

    const isPresent = () => env.isFocused() && env.now() - lastActivityAt < USER_IDLE_AFTER_MS;

    return {
        isPresent,
        recordActivity() {
            // Hovering over a visible but unfocused window is not reading it.
            if (!env.isFocused()) return;
            const wasPresent = isPresent();
            lastActivityAt = env.now();
            if (!wasPresent) {
                listeners.forEach((listener) => listener());
            }
        },
        recordLeave() {
            if (!env.isFocused()) {
                lastActivityAt = -Infinity;
            }
        },
        onPresent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

function createWebUserAttention(): UserAttention {
    const attention = createUserAttention({
        now: () => Date.now(),
        isFocused: () => document.visibilityState === 'visible' && document.hasFocus(),
    });

    const options = { capture: true, passive: true };
    const record = () => attention.recordActivity();
    let lastScreenX = -1;
    let lastScreenY = -1;
    window.addEventListener('mousemove', (event) => {
        // Browsers send mousemove without movement (layout shifts under the cursor); skip those.
        if (event.screenX === lastScreenX && event.screenY === lastScreenY) return;
        lastScreenX = event.screenX;
        lastScreenY = event.screenY;
        record();
    }, options);
    for (const type of ['mousedown', 'keydown', 'wheel', 'touchstart'] as const) {
        window.addEventListener(type, record, options);
    }

    // `blur` also fires when focus moves into an iframe of this page, where `hasFocus()` stays
    // true; check once focus has settled.
    const leave = () => setTimeout(() => attention.recordLeave(), 0);
    window.addEventListener('blur', leave);
    document.addEventListener('visibilitychange', leave);
    return attention;
}

const alwaysPresent: UserAttention = {
    isPresent: () => true,
    recordActivity: () => {},
    recordLeave: () => {},
    onPresent: () => () => {},
};

/**
 * Whether the person is actually looking at the app, so an open session is not marked read while
 * the desktop (Tauri) or browser window sits unfocused or idle. Native keeps treating a foreground
 * app as looked at.
 */
export const userAttention: UserAttention =
    Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined'
        ? createWebUserAttention()
        : alwaysPresent;
