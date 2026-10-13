import { memo, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTerminalPanelAvailable } from '@/hooks/useOpenTerminal';
import { TerminalPanel } from './TerminalPanel';
import { toggleTerminalPanel, useTerminalPanelOpen } from './terminalPanelState';

/**
 * The column the app's pages are shown in, with the terminal panel along its bottom.
 *
 * The panel sits under the pages rather than in one, so going from page to page leaves it, its
 * shells and its size as they were. It is mounted the first time it is opened, not before: an
 * app that never opens it never lists anyone's terminals.
 *
 * Ctrl+` shows and hides it from anywhere, as it does in an editor.
 */
export const TerminalPanelDock = memo(({ children }: { children: ReactNode }) => {
    const available = useTerminalPanelAvailable();
    const open = useTerminalPanelOpen();
    const [columnHeight, setColumnHeight] = useState(0);
    // Adjusted while rendering, so the render that opens the panel is the one that mounts it.
    const [hasOpened, setHasOpened] = useState(open);
    if (open && !hasOpened) {
        setHasOpened(true);
    }

    useEffect(() => {
        if (!available) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            // By key position rather than character: the key left of 1 types something else
            // on many layouts, and that is still the key people reach for.
            if (event.code !== 'Backquote' || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
                return;
            }
            // Caught before the terminal's own handling, which would send the shell a NUL.
            event.preventDefault();
            event.stopPropagation();
            toggleTerminalPanel();
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [available]);

    return (
        <View style={styles.column} onLayout={(event) => setColumnHeight(event.nativeEvent.layout.height)}>
            <View style={styles.pages}>
                {children}
            </View>
            {available && hasOpened ? <TerminalPanel columnHeight={columnHeight} open={open} /> : null}
        </View>
    );
});

const styles = StyleSheet.create({
    column: {
        flex: 1,
    },
    pages: {
        flexBasis: 0,
        flexGrow: 1,
    },
});
