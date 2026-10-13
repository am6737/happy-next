import type { TeammateTokenUsage } from 'happy-wire';

export function teammateTokenUsage(tokens: Record<string, unknown> | null | undefined): TeammateTokenUsage {
    const metric = (key: string) => {
        const value = tokens?.[key];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    return {
        input: metric('input'),
        cacheRead: metric('cache_read'),
        cacheWrite: metric('cache_creation'),
        output: metric('output') + metric('reasoning'),
    };
}
