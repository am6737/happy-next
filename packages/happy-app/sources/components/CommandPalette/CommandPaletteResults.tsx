import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Command, CommandCategory } from './types';
import { CommandPaletteItem } from './CommandPaletteItem';
import { CommandPaletteTile } from './CommandPaletteTile';
import { isTileCategory } from './search';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isOutOfView, NavigationAnchor } from './navigationAnchor';

interface CommandPaletteResultsProps {
    categories: CommandCategory[];
    selectedIndex: number;
    onSelectCommand: (command: Command) => void;
    // Set here, read by the arrow keys
    anchorRef: React.MutableRefObject<NavigationAnchor | null>;
    executingCommandId: string | null;
    searchQuery: string;
    tileColumns: number;
}

// Memoized: showing or hiding the palette must not re-render every result row
export const CommandPaletteResults = React.memo(function CommandPaletteResults({ 
    categories, 
    selectedIndex, 
    onSelectCommand, 
    anchorRef,
    executingCommandId,
    searchQuery,
    tileColumns,
}: CommandPaletteResultsProps) {
    const scrollViewRef = useRef<ScrollView>(null);
    const itemRefs = useRef<{ [key: number]: View | null }>({});
    
    // Flatten commands for index tracking
    const allCommands = React.useMemo(() => {
        return categories.flatMap(cat => cat.commands);
    }, [categories]);

    // Rows call back with their index and the latest command is looked up here, so a memoized row
    // never runs a stale command's action
    const allCommandsRef = useRef(allCommands);
    allCommandsRef.current = allCommands;
    const handlePressIndex = React.useCallback((index: number) => {
        const command = allCommandsRef.current[index];
        if (command) onSelectCommand(command);
    }, [onSelectCommand]);
    const registerRef = React.useCallback((index: number, ref: View | null) => {
        itemRefs.current[index] = ref;
    }, []);

    // The row under the mouse. Hovering never moves the selection, so scrolling the list with the
    // arrow keys can't drag the selection back to wherever the mouse happens to rest
    // Kept as an id: sessions sync while the palette is open, rebuilding the list without moving the mouse
    const hoveredIdRef = useRef<string | null>(null);
    const handleHoverIndex = React.useCallback((index: number, hovered: boolean) => {
        const id = allCommandsRef.current[index]?.id ?? null;
        if (hovered) hoveredIdRef.current = id;
        else if (hoveredIdRef.current === id) hoveredIdRef.current = null;
    }, []);

    const selectedIndexRef = useRef(selectedIndex);
    selectedIndexRef.current = selectedIndex;
    anchorRef.current = () => {
        const hovered = allCommandsRef.current.findIndex((command) => command.id === hoveredIdRef.current);
        if (hovered === -1) return null;
        const scrollableNode = (scrollViewRef.current as any)?.getScrollableNode?.();
        return isOutOfView(itemRefs.current[selectedIndexRef.current], scrollableNode) ? hovered : null;
    };

    // Scroll to the selected item when index changes
    useEffect(() => {
        const selectedItem = itemRefs.current[selectedIndex];
        if (selectedItem && scrollViewRef.current) {
            // For web, we need to use the DOM API
            if (typeof (selectedItem as any).scrollIntoView === 'function') {
                (selectedItem as any).scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                });
            }
        }
    }, [selectedIndex]);

    if (categories.length === 0 || allCommands.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, Typography.default()]}>
                    {t('commandPalette.noResults')}
                </Text>
            </View>
        );
    }

    let currentIndex = 0;

    return (
        <ScrollView 
            ref={scrollViewRef}
            style={styles.container}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            {categories.map(category => {
                if (category.commands.length === 0) return null;
                
                const categoryStartIndex = currentIndex;
                const asTiles = isTileCategory(category, searchQuery);
                const categoryCommands = category.commands.map((command, idx) => {
                    const commandIndex = categoryStartIndex + idx;
                    const isSelected = commandIndex === selectedIndex;
                    currentIndex++;

                    return (
                        <ResultRow
                            key={command.id}
                            command={command}
                            index={commandIndex}
                            isSelected={isSelected}
                            isExecuting={executingCommandId === command.id}
                            searchQuery={searchQuery}
                            tileWidth={asTiles ? `${100 / tileColumns}%` : undefined}
                            onPressIndex={handlePressIndex}
                            onHoverIndex={handleHoverIndex}
                            registerRef={registerRef}
                        />
                    );
                });

                return (
                    <View key={category.id}>
                        <Text style={[styles.categoryTitle, Typography.default('semiBold')]}>
                            {category.title}
                        </Text>
                        {asTiles ? <View style={styles.tileGrid}>{categoryCommands}</View> : categoryCommands}
                    </View>
                );
            })}
        </ScrollView>
    );
});

interface ResultRowProps {
    command: Command;
    index: number;
    isSelected: boolean;
    isExecuting: boolean;
    searchQuery: string;
    // Set for a tile in the idle grid
    tileWidth?: string;
    onPressIndex: (index: number) => void;
    onHoverIndex: (index: number, hovered: boolean) => void;
    registerRef: (index: number, ref: View | null) => void;
}

// Commands are rebuilt whenever sessions change, so rows compare what they show rather than identity;
// only rows whose content changed re-render
function sameCommand(a: Command, b: Command): boolean {
    if (a === b) return true;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const left = (a as any)[key];
        const right = (b as any)[key];
        if (typeof left === 'function' && typeof right === 'function') continue;
        if (Array.isArray(left) && Array.isArray(right)) {
            if (left.length !== right.length || left.some((value, i) => value !== right[i])) return false;
            continue;
        }
        if (left !== right) return false;
    }
    return true;
}

const ResultRow = React.memo(function ResultRow({ command, index, isSelected, isExecuting, searchQuery, tileWidth, onPressIndex, onHoverIndex, registerRef }: ResultRowProps) {
    const handlePress = React.useCallback(() => onPressIndex(index), [index, onPressIndex]);
    const handleHover = React.useCallback((hovered: boolean) => onHoverIndex(index, hovered), [index, onHoverIndex]);
    const handleRef = React.useCallback((ref: View | null) => registerRef(index, ref), [index, registerRef]);

    if (tileWidth) {
        return (
            <View style={[styles.tileCell, { width: tileWidth as any }]} ref={handleRef}>
                <CommandPaletteTile
                    command={command}
                    isSelected={isSelected}
                    onPress={handlePress}
                    onHover={handleHover}
                    isExecuting={isExecuting}
                />
            </View>
        );
    }

    return (
        <View ref={handleRef}>
            <CommandPaletteItem
                command={command}
                isSelected={isSelected}
                onPress={handlePress}
                onHover={handleHover}
                isExecuting={isExecuting}
                searchQuery={searchQuery}
            />
        </View>
    );
}, (prev, next) => (
    prev.index === next.index
    && prev.isSelected === next.isSelected
    && prev.isExecuting === next.isExecuting
    && prev.searchQuery === next.searchQuery
    && prev.tileWidth === next.tileWidth
    && prev.onPressIndex === next.onPressIndex
    && prev.onHoverIndex === next.onHoverIndex
    && prev.registerRef === next.registerRef
    && sameCommand(prev.command, next.command)
));

const styles = StyleSheet.create((theme) => ({
    container: {
        flexShrink: 1,
        // Use viewport-based height for better proportions
        ...(Platform.OS === 'web' ? {
            maxHeight: '72vh', // Leaves room for the input and footer within the 80vh container
        } as any : {
            maxHeight: 560, // Fallback for native
        }),
        paddingVertical: 4,
    },
    emptyContainer: {
        padding: 32,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        letterSpacing: -0.2,
    },
    tileGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 6,
    },
    tileCell: {
        paddingVertical: 2,
    },
    categoryTitle: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 6,
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        fontWeight: '600',
    },
}));
