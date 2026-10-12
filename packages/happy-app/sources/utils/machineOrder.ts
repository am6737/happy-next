// The user's machine order (settings.machineOrder), shared by every machine list in the app.

// Listed machines first, in the saved order; the rest after them, in the order they came in.
export function applyMachineOrder<T>(items: readonly T[], getId: (item: T) => string, order: readonly string[]): T[] {
    const rank = new Map(order.map((id, index) => [id, index]));
    return items
        .map((item, index) => ({ item, index, rank: rank.get(getId(item)) }))
        .sort((a, b) => {
            if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
            if (a.rank !== undefined) return -1;
            if (b.rank !== undefined) return 1;
            return a.index - b.index;
        })
        .map(entry => entry.item);
}

// The saved order after the visible machines were reordered: those in their new order, then the
// saved machines not on screen (offline ones), so they keep a place for when they come back.
export function mergeMachineOrder(saved: readonly string[], visible: readonly string[]): string[] {
    const shown = new Set(visible);
    return [...visible, ...saved.filter(id => !shown.has(id))];
}

// Machines as every list shows them: by name (display name, else host), unless the user put them
// in an order of their own (settings > machines).
export function sortMachines<T extends { id: string; metadata: { displayName?: string; host: string } | null }>(
    machines: readonly T[],
    order: readonly string[],
): T[] {
    const name = (machine: T) => machine.metadata?.displayName || machine.metadata?.host || machine.id;
    return applyMachineOrder([...machines].sort((a, b) => name(a).localeCompare(name(b))), machine => machine.id, order);
}
