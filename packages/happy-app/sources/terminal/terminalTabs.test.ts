import { describe, expect, it } from 'vitest';
import type { TerminalInfo } from 'happy-wire';
import {
    applyTerminalTabOrder,
    moveTerminalTab,
    resolveActiveTerminalTab,
    resolveTerminalTabLabels,
    shortenTerminalDirectory,
    sortTerminalTabs,
    terminalTabKey,
    type TerminalTab,
} from './terminalTabs';

function tab(id: string, machineId = 'machine_a', overrides: Partial<TerminalInfo> = {}): TerminalTab {
    return {
        machineId,
        terminal: {
            id,
            cwd: '/Users/someone/project',
            size: { rows: 24, cols: 80 },
            exited: false,
            ...overrides,
        },
    };
}

const MACHINE_NAMES: Record<string, string> = {
    machine_a: 'Mac mini',
    machine_b: 'MacBook Pro',
};

function labelOf(tabs: TerminalTab[], target: TerminalTab): string {
    const labels = resolveTerminalTabLabels(tabs, (machineId) => MACHINE_NAMES[machineId]);
    return labels.get(terminalTabKey(target))!;
}

describe('resolveTerminalTabLabels', () => {
    it('prefers the title the shell announced', () => {
        const only = tab('term_1', 'machine_a', { title: 'vim README.md' });
        expect(labelOf([only], only)).toBe('vim README.md');
    });

    it('falls back to the directory name', () => {
        const only = tab('term_1', 'machine_a', { cwd: '/Users/someone/project' });
        expect(labelOf([only], only)).toBe('project');
    });

    it('ignores a title that is only whitespace', () => {
        const only = tab('term_1', 'machine_a', { title: '   ', cwd: '/srv/app' });
        expect(labelOf([only], only)).toBe('app');
    });

    it('handles a trailing slash', () => {
        const only = tab('term_1', 'machine_a', { cwd: '/srv/app/' });
        expect(labelOf([only], only)).toBe('app');
    });

    it('falls back to the id for the filesystem root', () => {
        // There is no directory name to show, and an empty tab is worse than a
        // technical one.
        const only = tab('term_1', 'machine_a', { cwd: '/' });
        expect(labelOf([only], only)).toBe('term_1');
    });

    it('falls back to the id when there is no directory at all', () => {
        // What `normalizeTerminal` stands in for a daemon that recorded none.
        // This is the shape that used to throw while labelling a tab.
        const only = tab('term_1', 'machine_a', { cwd: '' });
        expect(labelOf([only], only)).toBe('term_1');
    });

    it('leaves the machine off when every tab is on one machine', () => {
        const first = tab('term_1', 'machine_a', { cwd: '/w/happy-next' });
        const second = tab('term_2', 'machine_a', { cwd: '/w/happy-next' });
        const tabs = [first, second];
        // The machine is not what tells these two apart, so naming it would
        // only spend width — a number does the job and costs two characters.
        expect(labelOf(tabs, first)).toBe('happy-next');
        expect(labelOf(tabs, second)).toBe('happy-next (2)');
    });

    it('names the machine when the same label spans machines', () => {
        const first = tab('term_1', 'machine_a', { cwd: '/w/happy-next' });
        const second = tab('term_2', 'machine_b', { cwd: '/w/happy-next' });
        const tabs = [first, second];
        // Both get it, not just the second: one of a pair reading differently is
        // harder to scan than both carrying the same suffix.
        expect(labelOf(tabs, first)).toBe('happy-next (Mac mini)');
        expect(labelOf(tabs, second)).toBe('happy-next (MacBook Pro)');
    });

    it('leaves the other tabs alone when only one pair collides', () => {
        const first = tab('term_1', 'machine_a', { cwd: '/w/happy-next' });
        const second = tab('term_2', 'machine_b', { cwd: '/w/happy-next' });
        const other = tab('term_3', 'machine_a', { cwd: '/w/paseo' });
        const tabs = [first, second, other];
        expect(labelOf(tabs, other)).toBe('paseo');
    });

    it('keeps the plain label when the machine has no name to give', () => {
        const first = tab('term_1', 'machine_a', { cwd: '/w/happy-next' });
        const second = tab('term_2', 'machine_unknown', { cwd: '/w/happy-next' });
        const labels = resolveTerminalTabLabels([first, second], (machineId) => MACHINE_NAMES[machineId]);
        expect(labels.get(terminalTabKey(second))).toBe('happy-next');
        expect(labels.get(terminalTabKey(first))).toBe('happy-next (Mac mini)');
    });

    it('numbers a second tab sharing a name on one machine', () => {
        const first = tab('term_1', 'machine_a', { cwd: '/w/tmp' });
        const second = tab('term_2', 'machine_a', { cwd: '/w/tmp' });
        expect(labelOf([first, second], first)).toBe('tmp');
        expect(labelOf([first, second], second)).toBe('tmp (2)');
    });

    it('counts a name that already carries a number as the name', () => {
        // A directory really called `tmp (2)` is read as `tmp`, so the next shell
        // in it is the second `tmp` rather than a second `tmp (2)`.
        const numbered = tab('term_1', 'machine_a', { cwd: '/w/tmp (2)' });
        const plain = tab('term_2', 'machine_a', { cwd: '/w/tmp' });
        expect(labelOf([numbered, plain], plain)).toBe('tmp (2)');
    });

    it('numbers within a machine, and names the machine after that', () => {
        const firstSibling = tab('term_1', 'machine_a', { cwd: '/w/tmp' });
        const secondSibling = tab('term_2', 'machine_a', { cwd: '/w/tmp' });
        const otherMachine = tab('term_3', 'machine_b', { cwd: '/w/tmp' });
        const tabs = [firstSibling, secondSibling, otherMachine];
        // The number sits next to the name it is numbering, not after the
        // machine — a `tmp (2) (Mac mini)` reads as the second tmp on the mini.
        expect(labelOf(tabs, firstSibling)).toBe('tmp (Mac mini)');
        expect(labelOf(tabs, secondSibling)).toBe('tmp (2) (Mac mini)');
        expect(labelOf(tabs, otherMachine)).toBe('tmp (MacBook Pro)');
    });

    it('drops the number again once the tab it was told apart from is gone', () => {
        const first = tab('term_1', 'machine_a', { cwd: '/w/tmp' });
        const second = tab('term_2', 'machine_a', { cwd: '/w/tmp' });
        expect(labelOf([first, second], second)).toBe('tmp (2)');
        expect(labelOf([second], second)).toBe('tmp');
    });

    it('reads a name given by hand instead of the shell title or the directory', () => {
        const named = tab('term_1', 'machine_a', { cwd: '/w/happy-next', title: 'vim README.md' });
        const labels = resolveTerminalTabLabels([named], () => undefined, { 'machine_a:term_1': 'build server' });
        expect(labels.get(terminalTabKey(named))).toBe('build server');
    });

    it('falls back to what the tab is when the name given is only whitespace', () => {
        const blank = tab('term_1', 'machine_a', { cwd: '/w/happy-next' });
        const labels = resolveTerminalTabLabels([blank], () => undefined, { 'machine_a:term_1': '   ' });
        expect(labels.get(terminalTabKey(blank))).toBe('happy-next');
    });

    it('numbers two tabs given the same name', () => {
        // Typed the same twice is still two tabs, and the strip has to be able
        // to tell them apart like any other pair.
        const first = tab('term_1', 'machine_a', { cwd: '/w/one' });
        const second = tab('term_2', 'machine_a', { cwd: '/w/two' });
        const names = { 'machine_a:term_1': 'build', 'machine_a:term_2': 'build' };
        const labels = resolveTerminalTabLabels([first, second], () => undefined, names);
        expect(labels.get(terminalTabKey(first))).toBe('build');
        expect(labels.get(terminalTabKey(second))).toBe('build (2)');
    });

    it('reads a name given by hand as its unnumbered form when numbering it', () => {
        // The same rule a directory gets: a name ending in a number is that name,
        // so a second one does not become `logs (2) (2)`.
        const named = tab('term_1', 'machine_a', { cwd: '/w/one' });
        const other = tab('term_2', 'machine_a', { cwd: '/w/two' });
        const names = { 'machine_a:term_1': 'logs (2)', 'machine_a:term_2': 'logs' };
        const labels = resolveTerminalTabLabels([named, other], () => undefined, names);
        expect(labels.get(terminalTabKey(named))).toBe('logs');
        expect(labels.get(terminalTabKey(other))).toBe('logs (2)');
    });
});

describe('resolveActiveTerminalTab', () => {
    const first = tab('term_a', 'machine_a');
    const second = tab('term_b', 'machine_a');

    it('honours the requested tab', () => {
        expect(resolveActiveTerminalTab([first, second], { machineId: 'machine_a', terminalId: 'term_a' }))
            .toBe(first);
    });

    it('does not confuse one machine\'s id for another\'s', () => {
        // Terminal ids are minted per machine, so a machine that happens to hand
        // out the same id must not be taken for the tab that was asked for.
        const other = tab('term_a', 'machine_b');
        const active = resolveActiveTerminalTab([first, other], { machineId: 'machine_b', terminalId: 'term_a' });
        expect(active).toBe(other);
    });

    it('falls back to the newest tab when the requested one is gone', () => {
        // It may have been closed from another device while this one was loading.
        expect(resolveActiveTerminalTab([first, second], { machineId: 'machine_a', terminalId: 'term_zzz' }))
            .toBe(second);
    });

    it('falls back to the newest tab when nothing was requested', () => {
        // Entering the workspace usually follows starting a terminal, and that
        // terminal is the newest one.
        expect(resolveActiveTerminalTab([first, second], null)).toBe(second);
    });

    it('has no active tab when there are none', () => {
        expect(resolveActiveTerminalTab([], { machineId: 'machine_a', terminalId: 'term_a' })).toBeNull();
    });
});

describe('sortTerminalTabs', () => {
    it('orders by id, which is creation order', () => {
        const later = tab('term_z');
        const earlier = tab('term_a');
        expect(sortTerminalTabs([later, earlier]).map((entry) => entry.terminal.id)).toEqual([
            'term_a',
            'term_z',
        ]);
    });

    it('orders across machines in the same sequence', () => {
        const first = tab('term_a', 'machine_b');
        const second = tab('term_b', 'machine_a');
        expect(sortTerminalTabs([second, first]).map((entry) => entry.terminal.id)).toEqual([
            'term_a',
            'term_b',
        ]);
    });

    it('does not mutate the input', () => {
        const input = [tab('term_z'), tab('term_a')];
        sortTerminalTabs(input);
        expect(input.map((entry) => entry.terminal.id)).toEqual(['term_z', 'term_a']);
    });
});

describe('applyTerminalTabOrder', () => {
    const first = tab('term_a');
    const second = tab('term_b');
    const third = tab('term_c');
    const ids = (tabs: TerminalTab[]) => tabs.map((entry) => entry.terminal.id);

    it('is creation order when nothing has been placed', () => {
        expect(ids(applyTerminalTabOrder([third, first, second], []))).toEqual(['term_a', 'term_b', 'term_c']);
    });

    it('puts the placed tabs in the order they were placed', () => {
        const order = [terminalTabKey(third), terminalTabKey(second), terminalTabKey(first)];
        expect(ids(applyTerminalTabOrder([first, second, third], order))).toEqual([
            'term_c',
            'term_b',
            'term_a',
        ]);
    });

    it('leaves unplaced tabs in creation order, after the placed ones', () => {
        // A terminal started since the order was written is not in it, and the
        // end of the strip is where a new tab belongs.
        expect(ids(applyTerminalTabOrder([first, second, third], [terminalTabKey(second)]))).toEqual([
            'term_b',
            'term_a',
            'term_c',
        ]);
    });

    it('ignores a key for a terminal that no longer exists', () => {
        const order = [terminalTabKey(tab('term_gone', 'machine_z')), terminalTabKey(second)];
        expect(ids(applyTerminalTabOrder([first, second, third], order))).toEqual([
            'term_b',
            'term_a',
            'term_c',
        ]);
    });

    it('takes the first of a repeated key', () => {
        // A key written twice must not silently move the tab to its later slot.
        const order = [terminalTabKey(second), terminalTabKey(second), terminalTabKey(first)];
        expect(ids(applyTerminalTabOrder([first, second, third], order))).toEqual([
            'term_b',
            'term_a',
            'term_c',
        ]);
    });

    it('orders across machines by key, not by id', () => {
        // Ids are minted per machine, so the same id on two of them is two tabs.
        const onA = tab('term_a', 'machine_a');
        const onB = tab('term_a', 'machine_b');
        const order = [terminalTabKey(onB), terminalTabKey(onA)];
        expect(applyTerminalTabOrder([onA, onB], order).map(terminalTabKey)).toEqual([
            terminalTabKey(onB),
            terminalTabKey(onA),
        ]);
    });

    it('does not mutate the input', () => {
        const input = [third, first, second];
        applyTerminalTabOrder(input, [terminalTabKey(third)]);
        expect(ids(input)).toEqual(['term_c', 'term_a', 'term_b']);
    });
});

describe('moveTerminalTab', () => {
    const first = tab('term_a');
    const second = tab('term_b');
    const third = tab('term_c');
    const tabs = [first, second, third];

    it('moves a tab later', () => {
        expect(moveTerminalTab(tabs, terminalTabKey(first), 2)).toEqual([
            terminalTabKey(second),
            terminalTabKey(third),
            terminalTabKey(first),
        ]);
    });

    it('moves a tab earlier', () => {
        expect(moveTerminalTab(tabs, terminalTabKey(third), 0)).toEqual([
            terminalTabKey(third),
            terminalTabKey(first),
            terminalTabKey(second),
        ]);
    });

    it('counts the target among the other tabs', () => {
        // Dropping at 1 means one tab is to the left of it — the dragged tab is
        // out of the sequence by then, so its own slot is not counted.
        expect(moveTerminalTab(tabs, terminalTabKey(third), 1)).toEqual([
            terminalTabKey(first),
            terminalTabKey(third),
            terminalTabKey(second),
        ]);
    });

    it('clamps a target past either end', () => {
        expect(moveTerminalTab(tabs, terminalTabKey(first), -5)).toEqual([
            terminalTabKey(first),
            terminalTabKey(second),
            terminalTabKey(third),
        ]);
        expect(moveTerminalTab(tabs, terminalTabKey(first), 99)).toEqual([
            terminalTabKey(second),
            terminalTabKey(third),
            terminalTabKey(first),
        ]);
    });

    it('leaves the sequence alone for a key that is not on screen', () => {
        const gone = terminalTabKey(tab('term_gone', 'machine_z'));
        expect(moveTerminalTab(tabs, gone, 0)).toEqual([
            terminalTabKey(first),
            terminalTabKey(second),
            terminalTabKey(third),
        ]);
    });

    it('speaks for every tab on screen', () => {
        // What gets persisted has to place all of them, or the ones left out
        // would fall back to creation order and undo the drag.
        expect(moveTerminalTab(tabs, terminalTabKey(second), 0)).toHaveLength(tabs.length);
    });

    it('does not mutate the input', () => {
        const input = [first, second, third];
        moveTerminalTab(input, terminalTabKey(first), 2);
        expect(input.map((entry) => entry.terminal.id)).toEqual(['term_a', 'term_b', 'term_c']);
    });
});

describe('shortenTerminalDirectory', () => {
    it('writes the home directory as a tilde', () => {
        expect(shortenTerminalDirectory('/Users/someone', '/Users/someone')).toBe('~');
    });

    it('shortens a path inside home', () => {
        expect(shortenTerminalDirectory('/Users/someone/wwwroot/happy-next', '/Users/someone')).toBe(
            '~/wwwroot/happy-next',
        );
    });

    it('leaves a path outside home alone', () => {
        expect(shortenTerminalDirectory('/srv/app', '/Users/someone')).toBe('/srv/app');
    });

    it('does not treat a shared prefix as being inside home', () => {
        // `/Users/someoneelse` starts with `/Users/someone` as a string, and
        // rewriting it to `~else/app` would be a lie about where it is.
        expect(shortenTerminalDirectory('/Users/someoneelse/app', '/Users/someone')).toBe(
            '/Users/someoneelse/app',
        );
    });

    it('tolerates a trailing slash on the home directory', () => {
        expect(shortenTerminalDirectory('/Users/someone/app', '/Users/someone/')).toBe('~/app');
    });

    it('leaves the path alone when the home directory is unknown', () => {
        expect(shortenTerminalDirectory('/srv/app', undefined)).toBe('/srv/app');
    });
});
