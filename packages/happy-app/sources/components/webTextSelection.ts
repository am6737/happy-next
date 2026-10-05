/**
 * True when the user currently has a non-empty text selection on web
 * (e.g. after drag-selecting inside a message bubble).
 */
export function hasWebTextSelection(
    getSelection: () => { toString(): string } | null = () => (typeof window === 'undefined' ? null : window.getSelection()),
): boolean {
    const selection = getSelection();
    return !!selection && selection.toString().length > 0;
}
