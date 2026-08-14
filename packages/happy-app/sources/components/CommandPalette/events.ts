export const OPEN_COMMAND_PALETTE_EVENT = 'happy:open-command-palette';

export function requestCommandPalette(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
    }
}
