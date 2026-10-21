import * as React from 'react';
import { View, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActionMenuItem } from './ActionMenu';
import { ActionMenuModal } from './ActionMenuModal';
import { actionMenuSection, ContextMenuView, nativeContextMenuAvailable } from './ContextMenuView';
import { MachineRailContextMenu, menuAt, type ContextMenuEvent, type MachineRailMenu } from './MachineRailContextMenu';
import { FLAT_ROW_RADIUS } from './flatRow';

export type RowLongPressProps = { onLongPress?: () => void; delayLongPress?: number };

/**
 * A list row's actions as a menu. On iOS they are its native context menu, elsewhere a long press
 * opens the sheet; on the web a right-click opens them at the cursor, the way the machine rail's do.
 * `children` renders the row and spreads the long-press props onto its pressable. Without items the
 * row is left as it is.
 *
 * The system's menu does not cancel React Native's touch handling, so a finger lifted just as the
 * menu lifts the row still reaches it as a tap. Pressability drops the `onPress` of a press it has
 * reported as a long press, so the row is given one to report, shorter than the roughly half second
 * the system takes to lift it — as `SessionContextMenu` does for a session row.
 */
export function RowContextMenu({ items, flat, children }: {
    items: ActionMenuItem[];
    // Laid flat on the background and rounded by its list, as the inbox lists it.
    flat?: boolean;
    children: (longPressProps: RowLongPressProps) => React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [webMenu, setWebMenu] = React.useState<MachineRailMenu | null>(null);
    const closeWebMenu = React.useCallback(() => setWebMenu(null), []);

    if (items.length === 0) {
        return <>{children({})}</>;
    }

    if (nativeContextMenuAvailable) {
        return (
            <ContextMenuView sections={[actionMenuSection(items)]} previewShape={flat ? styles.flatRowShape : undefined}>
                {/* Opaque for the lifted preview; a flat row takes the page's colour, a card's the card's. */}
                <View style={{ backgroundColor: flat ? theme.colors.groupped.background : theme.colors.surface }}>
                    {children({ onLongPress: () => {}, delayLongPress: 350 })}
                </View>
            </ContextMenuView>
        );
    }

    const openWebMenu = (event: ContextMenuEvent) => setWebMenu(menuAt(event, items.map((item) => ({
        label: item.label,
        icon: item.icon?.ionicon ?? 'ellipsis-horizontal',
        destructive: item.destructive,
        disabled: item.disabled,
        onPress: item.onPress,
    }))));

    return (
        <>
            <View
                // Spread rather than written inline: `onContextMenu` is a DOM prop the React Native types do not carry.
                {...(Platform.OS === 'web' ? { onContextMenu: openWebMenu } : {})}
            >
                {children({ onLongPress: Platform.OS === 'web' ? undefined : () => setMenuVisible(true) })}
            </View>
            <ActionMenuModal visible={menuVisible} items={items} onClose={() => setMenuVisible(false)} />
            <MachineRailContextMenu menu={webMenu} onClose={closeWebMenu} />
        </>
    );
}

const styles = StyleSheet.create({
    // The lifted preview is rounded as the inbox rounds the row.
    flatRowShape: {
        borderRadius: FLAT_ROW_RADIUS,
    },
});
