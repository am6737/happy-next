export function appendImagesWithinLimit<T>(current: T[], incoming: T[], maxImages: number): T[] {
    const remaining = Math.max(0, maxImages - current.length);
    if (remaining === 0) return current;
    return [...current, ...incoming.slice(0, remaining)];
}
