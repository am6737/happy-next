const EXPO_COMPATIBILITY_TOKEN_TIMEOUT_MS = 3_000;

// Expo token acquisition cannot be cancelled. Only wait a bounded amount of time
// for this optional token; a late result must never continue into server binding.
export async function getExpoCompatibilityToken(
    getToken: () => Promise<{ data: string }>,
): Promise<string | null> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            getToken().then(({ data }) => data),
            new Promise<null>((resolve) => {
                timeout = setTimeout(() => resolve(null), EXPO_COMPATIBILITY_TOKEN_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}
