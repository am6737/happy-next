import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { TerminalGridView } from '@/terminal/TerminalGridView';
import { TerminalKeyBar } from '@/terminal/TerminalKeyBar';
import { TerminalTabBar } from '@/terminal/TerminalTabBar';
import { createNativeHeadlessTerminal, type TerminalViewportState } from '@/terminal/headlessTerminalState';
import { resolveTerminalTheme } from '@/terminal/terminalTheme';
import { resolveTerminalTabLabels, terminalTabKey, applyTerminalTabOrder, type TerminalTab } from '@/terminal/terminalTabs';

/**
 * Renders a fixed ANSI fixture through the real terminal pipeline.
 *
 * No socket, no daemon, no login: this exists so the renderer can be inspected
 * on its own, and so a change to the row model or the palette has a stable
 * reference to be diffed against. Every line below is chosen to exercise one
 * thing the renderer has to get right.
 */
const FIXTURE = [
    '\x1b[2J\x1b[H',
    '\x1b[1;1H\x1b[0;1mBOLD\x1b[0m \x1b[3mITALIC\x1b[0m \x1b[4mUNDERLINE\x1b[0m \x1b[9mSTRIKE\x1b[0m \x1b[2mDIM\x1b[0m',
    '\x1b[3;1H\x1b[0m',
    '\x1b[3;1Hfg:  ',
    ...Array.from({ length: 8 }, (_, index) => `\x1b[3${index}m${index}\x1b[0m `),
    '\x1b[4;1Hbg:  ',
    ...Array.from({ length: 8 }, (_, index) => `\x1b[4${index}m${index}\x1b[0m `),
    '\x1b[5;1Hbrt: ',
    ...Array.from({ length: 8 }, (_, index) => `\x1b[9${index}m${index}\x1b[0m `),
    '\x1b[6;1Hidx: ',
    ...Array.from({ length: 8 }, (_, index) => `\x1b[38;5;${index * 30 + 20}m${String(index * 30 + 20).padStart(3, ' ')}\x1b[0m `),
    '\x1b[7;1Hrgb: ',
    '\x1b[38;2;255;0;0mRED\x1b[0m \x1b[38;2;0;255;0mGRN\x1b[0m \x1b[38;2;0;0;255mBLU\x1b[0m \x1b[38;2;255;165;0mORG\x1b[0m',
    // Box drawing is drawn with SVG paths rather than font glyphs, so a
    // regression there looks like missing lines rather than wrong characters.
    '\x1b[9;1H┌─────┬─────┐',
    '\x1b[10;1H│ box │ drw │',
    '\x1b[11;1H├─────┼─────┤',
    '\x1b[12;1H│ ██▓▒░ │ ▲▼◀▶ │',
    '\x1b[13;1H└─────┴─────┘',
    // Widened cells: the renderer advances by recorded cell width, not by
    // measuring the glyph, so these catch a wrong width coming out of xterm.
    '\x1b[15;1HCJK: 你好世界 日本語 한국어',
    '\x1b[16;1Hemoji: 🚀 ✅ 🎉',
    '\x1b[18;1Htrailing: end',
    '\x1b[20;5Hcursor was placed at row 20 col 5',
].join('');

const ROWS = 24;
const COLS = 80;

/**
 * Two shells in the same directory on different machines, which is the one case
 * the tab strip has to spell the machine out for.
 */
const TAB_BAR_FIXTURE: TerminalTab[] = [
    { machineId: 'machine_a', terminal: { id: 'term_a', cwd: '/Users/someone/wwwroot/happy-next', size: { rows: ROWS, cols: COLS }, exited: false } },
    { machineId: 'machine_a', terminal: { id: 'term_b', cwd: '/Users/someone/wwwroot/paseo', size: { rows: ROWS, cols: COLS }, exited: false } },
    { machineId: 'machine_b', terminal: { id: 'term_c', cwd: '/Users/someone/wwwroot/happy-next', size: { rows: ROWS, cols: COLS }, exited: false } },
];

const TAB_BAR_MACHINE_NAMES = new Map([
    ['machine_a', 'Mac mini'],
    ['machine_b', 'MacBook Pro'],
]);

export default function TerminalHarnessScreen() {
    const { rt } = useUnistyles();
    const systemScheme = rt.themeName === 'light' || rt.themeName === 'dark' ? rt.themeName : 'dark';
    const [viewport, setViewport] = React.useState<TerminalViewportState | null>(null);
    const [text, setText] = React.useState('');
    // Purely to see the highlight; nothing here is wired to a shell.
    const [ctrlActive, setCtrlActive] = React.useState(false);
    // Dragging the strip here is real: it lets the reorder be tried without a
    // daemon, since the fixture stands in for the daemon's list.
    const [tabs, setTabs] = React.useState<TerminalTab[]>(TAB_BAR_FIXTURE);

    React.useEffect(() => {
        const mirror = createNativeHeadlessTerminal({ rows: ROWS, cols: COLS });
        let cancelled = false;
        void mirror.write(FIXTURE).then(() => {
            if (cancelled) {
                return;
            }
            const state = mirror.getViewportState();
            setViewport(state);
            setText(
                state.grid
                    .map((row) => row.map((cell) => cell.char).join('').trimEnd())
                    .join('\n'),
            );
        });
        return () => {
            cancelled = true;
            mirror.dispose();
        };
    }, []);

    return (
        <ScrollView style={styles.root} contentContainerStyle={styles.content}>
            <Text style={styles.heading}>{`rendered grid ${COLS}x${ROWS} (${systemScheme})`}</Text>
            {viewport ? (
                <TerminalGridView state={viewport} xtermTheme={resolveTerminalTheme(systemScheme)} />
            ) : (
                <Text style={styles.heading}>loading…</Text>
            )}
            {/* The same screen as plain text, so rendered output can be compared
                against what the mirror actually holds. */}
            <Text style={styles.heading}>extracted text</Text>
            <View style={styles.textBox}>
                <Text style={styles.mono}>{text}</Text>
            </View>
            <Text style={styles.heading}>key bar</Text>
            <TerminalKeyBar
                ctrlActive={ctrlActive}
                onToggleCtrl={() => setCtrlActive((active) => !active)}
                onKey={() => {}}
                onSend={() => {}}
            />
            <Text style={styles.heading}>tab bar</Text>
            <TerminalTabBar
                activeKey={terminalTabKey(TAB_BAR_FIXTURE[0]!)}
                labels={resolveTerminalTabLabels(tabs, (machineId) => TAB_BAR_MACHINE_NAMES.get(machineId))}
                onClose={() => {}}
                onDuplicate={() => {}}
                onNew={() => {}}
                onRename={() => {}}
                onReorder={(order) => setTabs((current) => applyTerminalTabOrder(current, order))}
                onSelect={() => {}}
                tabs={tabs}
            />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    content: {
        gap: 8,
        padding: 16,
    },
    heading: {
        color: '#8E8E93',
        fontSize: 12,
    },
    textBox: {
        backgroundColor: '#000000',
        padding: 8,
    },
    mono: {
        color: '#E0E0E0',
        fontFamily: 'Menlo',
        fontSize: 10,
    },
});
