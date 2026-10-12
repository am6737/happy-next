import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Command, CommandCategory } from './types';
import { CommandPaletteItem } from './CommandPaletteItem';
import { CommandPaletteTile } from './CommandPaletteTile';
import { isTileCategory } from './search';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface CommandPaletteResultsProps {
    categories: CommandCategory[];
    selectedIndex: number;
    onSelectCommand: (command: Command) => void;
    onSelectionChange: (index: number) => void;
    executingCommandId: string | null;
    searchQuery: string;
    tileColumns: number;
}

export function CommandPaletteResults({ 
    categories, 
    selectedIndex, 
    onSelectCommand, 
    onSelectionChange,
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

    // Scroll to selected item when index changes
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

                    if (asTiles) {
                        return (
                            <View
                                key={command.id}
                                style={[styles.tileCell, { width: `${100 / tileColumns}%` }]}
                                ref={(ref) => {
                                    itemRefs.current[commandIndex] = ref;
                                }}
                            >
                                <CommandPaletteTile
                                    command={command}
                                    isSelected={isSelected}
                                    onPress={() => onSelectCommand(command)}
                                    onHover={() => onSelectionChange(commandIndex)}
                                    isExecuting={executingCommandId === command.id}
                                />
                            </View>
                        );
                    }

                    return (
                        <View
                            key={command.id}
                            ref={(ref) => {
                                itemRefs.current[commandIndex] = ref;
                            }}
                        >
                            <CommandPaletteItem
                                command={command}
                                isSelected={isSelected}
                                onPress={() => onSelectCommand(command)}
                                onHover={() => onSelectionChange(commandIndex)}
                                isExecuting={executingCommandId === command.id}
                                searchQuery={searchQuery}
                            />
                        </View>
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
}

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
