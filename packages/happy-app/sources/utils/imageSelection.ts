export function appendWithinLimit<T>(current: T[], incoming: T[], limit: number): T[] {
    if (current.length >= limit || incoming.length === 0) return current;
    return [...current, ...incoming.slice(0, limit - current.length)];
}
