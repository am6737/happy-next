import * as React from 'react';
import { useRouter } from "expo-router"

// Stable across renders: lists hand it (or callbacks built on it) to every row, and a new
// function each render re-rendered all of them.
export function useNavigateToSession() {
    const router = useRouter();
    return React.useCallback((sessionId: string) => {
        router.navigate(`/session/${sessionId}`, {
            dangerouslySingular(name, params) {
                return 'session'
            },
        });
    }, [router]);
}
