import { useEffect, useState } from 'react';

/**
 * The current time as a state that refreshes every second while `enabled`.
 *
 * For values derived from "now" (like the length of something still running) that cannot be
 * expressed as a single start date for `useElapsedTime`, e.g. the sum of several attempts. When
 * disabled the returned time is not updated, so a finished value costs no timer.
 */
export function useTickingNow(enabled: boolean): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        setNow(Date.now());
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [enabled]);

    return now;
}
