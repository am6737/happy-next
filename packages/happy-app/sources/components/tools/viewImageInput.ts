export function getViewImagePath(input: unknown): string | null {
    if (!input || typeof input !== 'object' || !('path' in input)) return null;
    return typeof input.path === 'string' && input.path.trim() ? input.path : null;
}

export function getViewImageDisplayPath(input: unknown, homeDir?: string): string | null {
    const path = getViewImagePath(input);
    if (!path || !homeDir) return path;
    const home = homeDir.replace(/[\\/]+$/, '');
    if (!home) return path;
    const windows = /^[A-Za-z]:[\\/]/.test(home);
    const normalizedPath = windows ? path.replace(/\\/g, '/').toLowerCase() : path;
    const normalizedHome = windows ? home.replace(/\\/g, '/').toLowerCase() : home;
    if (normalizedPath === normalizedHome) return '~';
    if (normalizedPath.startsWith(`${normalizedHome}/`)) return `~${path.slice(home.length)}`;
    return path;
}
