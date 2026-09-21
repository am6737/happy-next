import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { DesktopWindowControls, WINDOWS_TITLE_BAR_HEIGHT } from '@/desktop/DesktopWindowControls';
import { getDesktopPlatform, handleDesktopTitleBarMouseDown } from '@/desktop/desktopWindowUtils';

/**
 * Kept in step with `TITLE_ROW_HEIGHT` in `src-tauri/src/lib.rs`, which uses it
 * to centre macOS's traffic lights in this row.
 */
const MACOS_TITLE_ROW_HEIGHT = 38;
/** The lights span from x=13 to x=65; the tabs start clear of them. */
const MACOS_TRAFFIC_LIGHT_GUTTER = 78;

/**
 * The terminal window's title area, which the tab strip stands in for.
 *
 * Neither platform draws a title bar here. macOS keeps its traffic lights and
 * has them moved down into this row, so the row begins clear of them; Windows
 * gives up its decorations entirely and the window buttons are drawn at the far
 * end. What is left between the tabs and those buttons is the only place the
 * window can be dragged from — a tab cannot double as a handle, because
 * dragging one would have to mean scrolling the strip.
 */
export function TerminalWindowTitleRow({ children }: { children: React.ReactNode }) {
    const { theme } = useUnistyles();
    const platform = getDesktopPlatform();
    const isMac = platform !== 'windows';

    const dragProps = React.useMemo(
        () =>
            platform
                ? ({
                      'data-tauri-drag-region': true,
                      onMouseDown: (event: unknown) =>
                          handleDesktopTitleBarMouseDown(event, { allowMaximize: true }),
                  } as Record<string, unknown>)
                : {},
        [platform],
    );

    return (
        <View
            style={[
                styles.row,
                {
                    backgroundColor: theme.colors.surface,
                    borderBottomColor: theme.colors.divider,
                    height: isMac ? MACOS_TITLE_ROW_HEIGHT : WINDOWS_TITLE_BAR_HEIGHT,
                },
                isMac && styles.rowMac,
            ]}
        >
            {children}
            <View {...dragProps} style={styles.dragSpace} />
            {!isMac && <DesktopWindowControls />}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        alignItems: 'stretch',
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
    },
    rowMac: {
        paddingLeft: MACOS_TRAFFIC_LIGHT_GUTTER,
    },
    dragSpace: {
        flexGrow: 1,
        flexShrink: 0,
        // Without a floor the tabs would take the whole row and leave nowhere to
        // grab, which is how a window stops being movable.
        minWidth: 48,
    },
});
