/**
 * True when the user currently has a non-empty text selection on web
 * (e.g. after drag-selecting inside a message bubble). Always false on
 * native, where `window` exists but has no `getSelection`.
 */
export function hasWebTextSelection(
    getSelection: () => { toString(): string } | null = readWindowSelection,
): boolean {
    const selection = getSelection();
    return !!selection && selection.toString().length > 0;
}

function readWindowSelection(): { toString(): string } | null {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
    return window.getSelection();
}
