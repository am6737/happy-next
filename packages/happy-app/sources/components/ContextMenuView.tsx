import * as React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { isRunningOnMac } from '@/utils/platform';
import type { ActionMenuItem } from './ActionMenu';

export type ContextMenuAction = {
    label: string;
    onPress: () => void;
    /** An SF Symbol name. */
    icon?: string;
    /** Draws `icon` in this colour (`#RRGGBB`) instead of the menu's, as for a colour swatch. */
    iconColor?: string;
    destructive?: boolean;
    disabled?: boolean;
    /** Shows the system checkmark (or, in a palette, the selection ring). */
    selected?: boolean;
};

export type ContextMenuSection = {
    title?: string;
    /** Lays the section's items out as a row of icons (iOS 17+; a submenu before that). */
    palette?: boolean;
    items: ContextMenuAction[];
};

/** A page's `ActionMenuItem`s as one menu section, for a menu that was a bottom sheet before. */
export function actionMenuSection(items: ActionMenuItem[]): ContextMenuSection {
    return {
        items: items.map((item) => ({
            label: item.label,
            onPress: item.onPress,
            destructive: item.destructive,
            disabled: item.disabled,
            selected: item.selected,
        })),
    };
}

type NativeMenuElement = {
    type: 'action' | 'group';
    id?: string;
    title?: string;
    systemImage?: string;
    imageColor?: string;
    destructive?: boolean;
    disabled?: boolean;
    checked?: boolean;
    inline?: boolean;
    palette?: boolean;
    children?: NativeMenuElement[];
};

type NativeContextMenuProps = {
    menu: { title?: string; items: NativeMenuElement[] };
    previewCornerRadii: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
    onSelectAction: (event: { nativeEvent: { id: string } }) => void;
    dragId?: string;
    dragPreviewColor?: string;
    onDragBegin?: () => void;
    onDragEnd?: () => void;
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
};

type NativeDropZoneProps = {
    onDragMove: (event: { nativeEvent: { id: string; x: number } }) => void;
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
};

// The native view lives in `modules/context-menu`. A binary built before it was added has no such
// module, and Catalyst keeps the menus it already has, so those fall back to the long press.
const NativeContextMenu: React.ComponentType<NativeContextMenuProps> | null =
    Platform.OS === 'ios' && !isRunningOnMac() && requireOptionalNativeModule('HappyContextMenu')
        ? requireNativeViewManager('HappyContextMenu')
        : null;

/**
 * Whether `ContextMenuView` opens a native context menu here. Where it does not, it is a plain view
 * and the caller keeps its own long press (and the sheet that opens).
 */
export const nativeContextMenuAvailable = NativeContextMenu !== null;

// Shipped with the drag; a binary from before it has the menus but no drag.
const NativeDropZone: React.ComponentType<NativeDropZoneProps> | null =
    NativeContextMenu && requireOptionalNativeModule('HappyDropZone')
        ? requireNativeViewManager('HappyDropZone')
        : null;

/** Whether a `ContextMenuView` with a `dragId` can be dragged around a `ContextMenuDropZone` here. */
export const nativeContextMenuDragAvailable = NativeDropZone !== null;

/**
 * Long-pressing the wrapped content lifts it and opens a native iOS context menu next to it, with
 * the system's glass, checkmarks, destructive rows and SF Symbols. A tap still reaches the content.
 * Sections are separated in the menu; a palette section is a row of swatches.
 *
 * `previewShape` is the content's own rounding (its `borderRadius` or per-corner radii), which the
 * lifted preview is clipped to.
 *
 * With a `dragId` (where `nativeContextMenuDragAvailable`) the content can also be dragged: moving
 * the finger once the menu is up closes it and carries a copy of the content, drawn on
 * `dragPreviewColor`, which a `ContextMenuDropZone` around it follows. `onDragBegin` and
 * `onDragEnd` bracket the drag; as the finger lifts the copy flies back onto the content, wherever
 * the content has been moved to by then.
 */
export function ContextMenuView({
    sections,
    title,
    previewShape,
    dragId,
    dragPreviewColor,
    onDragBegin,
    onDragEnd,
    style,
    children,
}: {
    sections: ContextMenuSection[];
    title?: string;
    previewShape?: StyleProp<ViewStyle>;
    dragId?: string;
    dragPreviewColor?: string;
    onDragBegin?: () => void;
    onDragEnd?: () => void;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}) {
    // Handlers are looked up when the event arrives, so they are always the latest render's.
    const sectionsRef = React.useRef(sections);
    sectionsRef.current = sections;
    const dragHandlersRef = React.useRef({ onDragBegin, onDragEnd });
    dragHandlersRef.current = { onDragBegin, onDragEnd };

    const menu = React.useMemo(() => ({
        title,
        items: sections.map((section, sectionIndex): NativeMenuElement => ({
            type: 'group',
            title: section.title,
            inline: true,
            palette: section.palette,
            children: section.items.map((item, itemIndex): NativeMenuElement => ({
                type: 'action',
                id: `${sectionIndex}:${itemIndex}`,
                title: item.label,
                systemImage: item.icon,
                imageColor: item.iconColor,
                destructive: item.destructive,
                disabled: item.disabled,
                checked: item.selected,
            })),
        })),
    }), [sections, title]);

    const previewCornerRadii = React.useMemo(() => {
        const shape = StyleSheet.flatten(previewShape) ?? {};
        const radius = typeof shape.borderRadius === 'number' ? shape.borderRadius : 0;
        const corner = (value: unknown) => (typeof value === 'number' ? value : radius);
        return {
            topLeft: corner(shape.borderTopLeftRadius),
            topRight: corner(shape.borderTopRightRadius),
            bottomLeft: corner(shape.borderBottomLeftRadius),
            bottomRight: corner(shape.borderBottomRightRadius),
        };
    }, [previewShape]);

    const handleSelect = React.useCallback((event: { nativeEvent: { id: string } }) => {
        const [sectionIndex, itemIndex] = event.nativeEvent.id.split(':').map(Number);
        sectionsRef.current[sectionIndex]?.items[itemIndex]?.onPress();
    }, []);
    const handleDragBegin = React.useCallback(() => dragHandlersRef.current.onDragBegin?.(), []);
    const handleDragEnd = React.useCallback(() => dragHandlersRef.current.onDragEnd?.(), []);

    if (!NativeContextMenu) {
        return <View style={style}>{children}</View>;
    }
    return (
        <NativeContextMenu
            menu={menu}
            previewCornerRadii={previewCornerRadii}
            onSelectAction={handleSelect}
            dragId={NativeDropZone ? dragId : undefined}
            dragPreviewColor={dragPreviewColor}
            onDragBegin={handleDragBegin}
            onDragEnd={handleDragEnd}
            style={style}
        >
            {children}
        </NativeContextMenu>
    );
}

/**
 * Follows a drag from a `ContextMenuView` inside it: `onDragMove` gets the dragged content's
 * `dragId` and the finger's `x` in this view, while the finger is over it. Nothing is dropped on
 * it; see `ContextMenuView` for where the drag lands. A plain view where there is no drag.
 */
export function ContextMenuDropZone({ onDragMove, style, children }: {
    onDragMove: (id: string, x: number) => void;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}) {
    const onDragMoveRef = React.useRef(onDragMove);
    onDragMoveRef.current = onDragMove;
    const handleDragMove = React.useCallback((event: { nativeEvent: { id: string; x: number } }) => {
        onDragMoveRef.current(event.nativeEvent.id, event.nativeEvent.x);
    }, []);

    if (!NativeDropZone) {
        return <View style={style}>{children}</View>;
    }
    return (
        <NativeDropZone onDragMove={handleDragMove} style={style}>
            {children}
        </NativeDropZone>
    );
}
