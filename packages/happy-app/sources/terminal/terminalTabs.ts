import type { TerminalInfo } from 'happy-wire';

/** One terminal, together with the machine running it. */
export interface TerminalTab {
    machineId: string;
    terminal: TerminalInfo;
}

/**
 * A directory as it should read in a status line.
 *
 * Nearly every shell starts in the home directory, and spelling that out spends
 * the whole width restating where someone already is.
 */
export function shortenTerminalDirectory(cwd: string, homeDir: string | undefined): string {
    const home = homeDir?.replace(/\/+$/, '');
    if (!home) {
        return cwd;
    }
    if (cwd === home) {
        return '~';
    }
    return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

/** What a tab is called, ignoring which machine it is on. */
function baseLabel(terminal: TerminalInfo, chosen?: string): string {
    // A name given by hand outranks everything: it was chosen for this tab,
    // where the title is only what the shell happens to be saying.
    const name = chosen?.trim();
    if (name) {
        return name;
    }
    const title = terminal.title?.trim();
    if (title) {
        return title;
    }
    const directory = terminal.cwd.replace(/\/+$/, '').split('/').pop();
    return directory && directory.length > 0 ? directory : terminal.id;
}

/** Numbering this code adds itself, so it can be taken back off before comparing. */
const NUMBER_SUFFIX = / \(\d+\)$/;

/**
 * A name with any numbering it already carries taken off.
 *
 * Two shells in `/w/tmp` read `tmp` and `tmp (2)`, and a third one started later
 * has to be told apart from both: counting the names as they are would make it
 * `tmp (2) (2)`. A name that really does end in a number — a directory called
 * `tmp (2)`, or a name given by hand — is read as `tmp` too, which is the one
 * place this guess is wrong; the cost of being wrong is a pair of tabs reading
 * `tmp` and `tmp (2)` rather than one reading `tmp (2)` twice.
 */
function stripTabNumber(label: string): string {
    return label.replace(NUMBER_SUFFIX, '');
}

/**
 * Identity for a tab.
 *
 * Terminal ids are minted per machine, so the id alone is not unique once the
 * strip spans several of them.
 */
export function terminalTabKey(tab: TerminalTab): string {
    return `${tab.machineId}:${tab.terminal.id}`;
}

/**
 * What each tab should read.
 *
 * A shell announces its own title over OSC once something names itself, which
 * is the most useful label available. Before that the directory stands in — a
 * bare id makes a row of tabs unreadable.
 *
 * The machine is appended only where it is the thing being confused: two tabs
 * reading the same on *different* machines. Two reading the same on one machine
 * are still told apart by what they are, and labelling every tab with a machine
 * it does not need would spend the row's width on nothing.
 *
 * Two shells that share a name on one machine are then numbered — the second is
 * `tmp (2)`. There is nothing else left to tell them apart with, and a row of
 * tabs reading the same is one nobody can pick from.
 *
 * `chosenNames` carries the names someone gave tabs by hand, by
 * `terminalTabKey`. They are names like any other here: one that collides is
 * numbered too, because a strip has to stay readable even when two of them were
 * typed the same.
 */
export function resolveTerminalTabLabels(
    tabs: readonly TerminalTab[],
    machineName: (machineId: string) => string | undefined,
    chosenNames: Readonly<Record<string, string>> = {},
): Map<string, string> {
    const labels = new Map<string, string>();
    const base = tabs.map((tab) =>
        stripTabNumber(baseLabel(tab.terminal, chosenNames[terminalTabKey(tab)])),
    );

    const machinesByLabel = new Map<string, Set<string>>();
    tabs.forEach((tab, index) => {
        const label = base[index]!;
        const machines = machinesByLabel.get(label) ?? new Set<string>();
        machines.add(tab.machineId);
        machinesByLabel.set(label, machines);
    });

    // Counted per machine as well as per name: two Mac minis each holding a
    // `tmp` are told apart by the machine, and numbering them would only add a
    // second thing to read.
    const seen = new Map<string, number>();
    tabs.forEach((tab, index) => {
        const label = base[index]!;
        const group = `${tab.machineId}\n${label}`;
        const count = (seen.get(group) ?? 0) + 1;
        seen.set(group, count);
        const numbered = count === 1 ? label : `${label} (${count})`;

        const name = (machinesByLabel.get(label)?.size ?? 0) > 1 ? machineName(tab.machineId) : undefined;
        labels.set(terminalTabKey(tab), name ? `${numbered} (${name})` : numbered);
    });

    return labels;
}

/**
 * Which tab to show.
 *
 * Prefers what the caller asked for. Failing that it takes the newest, not the
 * oldest: the workspace is almost always entered just after a terminal was
 * started from a session, and that terminal is the one being looked for. The
 * fallback also covers a terminal closed from another device while this window
 * was loading.
 */
export function resolveActiveTerminalTab(
    tabs: readonly TerminalTab[],
    requested: { machineId: string; terminalId: string } | null,
): TerminalTab | null {
    if (tabs.length === 0) {
        return null;
    }
    if (requested) {
        const match = tabs.find(
            (tab) => tab.machineId === requested.machineId && tab.terminal.id === requested.terminalId,
        );
        if (match) {
            return match;
        }
    }
    // `tabs` arrives sorted by creation, so the tail is the most recent.
    return tabs[tabs.length - 1]!;
}

/**
 * Tabs in a stable order.
 *
 * Ids are minted with a base-36 timestamp prefix, so sorting by id is creation
 * order — but a stable one, unlike list order, which would shift every tab
 * along whenever an earlier one was closed. Machines disagree about the exact
 * millisecond, which is fine: this only has to be chronological to the second.
 */
export function sortTerminalTabs(tabs: readonly TerminalTab[]): TerminalTab[] {
    return [...tabs].sort((left, right) => left.terminal.id.localeCompare(right.terminal.id));
}

/** Sorts after every tab the order actually places. */
const UNPLACED = Number.MAX_SAFE_INTEGER;

/**
 * The strip in the order it was dragged into.
 *
 * The order is a preference over tabs the daemon owns, so it is sparse by
 * nature: it knows nothing about a terminal started since it was written. Those
 * fall back to creation order — and, because an unplaced rank sorts last, they
 * fall in at the end, which is where a tab the person has not placed belongs.
 * That also means a key left over from a terminal that no longer exists is
 * simply never matched, so nothing has to be pruned.
 */
export function applyTerminalTabOrder(
    tabs: readonly TerminalTab[],
    order: readonly string[],
): TerminalTab[] {
    const rank = new Map<string, number>();
    order.forEach((key, index) => {
        // First occurrence wins, so a key written twice cannot shuffle anything.
        if (!rank.has(key)) {
            rank.set(key, index);
        }
    });

    // Sorting first and then ranking by a stable sort means the tabs this order
    // does not place keep exactly the sequence they would have had without it.
    return sortTerminalTabs(tabs)
        .map((tab, index) => ({ index, tab, rank: rank.get(terminalTabKey(tab)) ?? UNPLACED }))
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .map((entry) => entry.tab);
}

/**
 * The strip order after one tab is dropped at `toIndex`.
 *
 * The result is the whole visible sequence, not just where the dragged tab
 * went: what gets persisted has to place every tab on screen, or the ones left
 * out would fall back to creation order and undo the drag. `toIndex` counts
 * positions among the *other* tabs, so it needs no adjustment for the dragged
 * tab being lifted out of the sequence first.
 *
 * Only what is on screen is spoken for. A tab that is not — one on a machine
 * that is away — keeps no rank, and lands at the end when it returns, exactly
 * as a terminal started since does.
 */
export function moveTerminalTab(
    tabs: readonly TerminalTab[],
    fromKey: string,
    toIndex: number,
): string[] {
    const keys = tabs.map(terminalTabKey);
    const from = keys.indexOf(fromKey);
    if (from === -1) {
        return keys;
    }
    const rest = [...keys.slice(0, from), ...keys.slice(from + 1)];
    const at = Math.max(0, Math.min(toIndex, rest.length));
    return [...rest.slice(0, at), fromKey, ...rest.slice(at)];
}
