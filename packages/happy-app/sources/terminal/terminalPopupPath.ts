export interface TerminalPopupFocus {
    machineId: string;
    terminalId: string;
}

/**
 * The workspace route, opened on one tab or, with no `focus`, on whichever it opens on.
 * `request` is what makes a repeat visit a change.
 */
export function buildTerminalPopupPath(focus: TerminalPopupFocus | undefined, request: string): string {
    const params = new URLSearchParams();
    if (focus) {
        params.set('machineId', focus.machineId);
        params.set('terminalId', focus.terminalId);
    }
    params.set('request', request);
    return `/terminals?${params.toString()}`;
}
