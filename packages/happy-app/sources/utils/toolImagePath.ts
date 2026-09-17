import { getToolImagePath } from 'happy-wire';

export { getToolImagePath };

/** Display form of a tool call's image path, with a leading home directory shortened to `~`. */
export function getToolImageDisplayPath(toolName: string, input: unknown, homeDir?: string): string | null {
    const path = getToolImagePath(toolName, input);
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
