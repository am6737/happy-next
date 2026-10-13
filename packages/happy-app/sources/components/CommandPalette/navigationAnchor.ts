import type { View } from 'react-native';

// The row an arrow key selects instead of moving the selection, or null to move it as usual.
// The mouse never moves the selection, but once the selected row has scrolled out of view the
// next arrow key selects the row under the mouse
export type NavigationAnchor = () => number | null;

// Web only: whether a row has scrolled fully out of its list's viewport
export function isOutOfView(row: View | null | undefined, scrollableNode: unknown): boolean {
    const element = row as unknown as HTMLElement | null | undefined;
    const container = scrollableNode as HTMLElement | null | undefined;
    if (!element?.getBoundingClientRect || !container?.getBoundingClientRect) return !element;
    const rowRect = element.getBoundingClientRect();
    const viewRect = container.getBoundingClientRect();
    return rowRect.bottom <= viewRect.top || rowRect.top >= viewRect.bottom;
}
