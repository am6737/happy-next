import React from 'react';
import { ActivityIndicator, Text, View, Platform, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { CommandPaletteInput } from './CommandPaletteInput';
import { CommandPaletteResults } from './CommandPaletteResults';
import { useCommandPalette } from './useCommandPalette';
import { Command } from './types';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

interface CommandPaletteProps {
    commands: Command[];
    searchCachedMessages?: (query: string) => Promise<CachedMessageSearchMatch[]>;
    onClose: () => void;
}

export function CommandPalette({ commands, searchCachedMessages, onClose }: CommandPaletteProps) {
    const { width, height } = useWindowDimensions();
    // Matches the modal's 90% / 800px width: four tiles per row when there's room, two on phones
    const tileColumns = Math.min(width * 0.9, 800) >= 600 ? 4 : 2;
    const { theme } = useUnistyles();
    const {
        searchQuery,
        selectedIndex,
        filteredCategories,
        inputRef,
        handleSearchChange,
        handleSelectCommand,
        handleKeyPress,
        setSelectedIndex,
        executingCommandId,
        isSearchingMessages,
    } = useCommandPalette(commands, onClose, searchCachedMessages, tileColumns);

    const resultCount = React.useMemo(
        () => filteredCategories.reduce((count, category) => count + category.commands.length, 0),
        [filteredCategories],
    );

    return (
        <View style={[styles.container, Platform.OS !== 'web' && { maxHeight: height * 0.8 }]}>
            <CommandPaletteInput
                value={searchQuery}
                onChangeText={handleSearchChange}
                onKeyPress={handleKeyPress}
                inputRef={inputRef}
            />
            <CommandPaletteResults
                categories={filteredCategories}
                selectedIndex={selectedIndex}
                onSelectCommand={handleSelectCommand}
                onSelectionChange={setSelectedIndex}
                executingCommandId={executingCommandId}
                searchQuery={searchQuery}
                tileColumns={tileColumns}
            />
            <View style={styles.footer}>
                <View style={styles.footerStatus}>
                    {isSearchingMessages && <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.footerSpinner} />}
                    {!!searchQuery.trim() && <Text style={[styles.footerText, Typography.default()]}>
                        {isSearchingMessages
                            ? t('commandPalette.searchingMessages')
                            : t('commandPalette.resultCount', { count: resultCount })}
                    </Text>}
                </View>
                {Platform.OS === 'web' && <View style={styles.footerHints}>
                    <Text style={[styles.footerText, Typography.default()]}>{t('commandPalette.navigateHint')}</Text>
                    <Text style={[styles.footerText, Typography.default()]}>{t('commandPalette.selectHint')}</Text>
                    <Text style={[styles.footerText, Typography.default()]}>{t('commandPalette.closeHint')}</Text>
                </View>}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        width: '100%',
        maxWidth: 800, // Increased from 640 for wider input
        // Use viewport-based height for better layout
        ...(Platform.OS === 'web' ? {
            maxHeight: '80vh', // Takes up to 80% of viewport height
        } as any : {
            maxHeight: 500, // Fallback for native
        }),
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: {
            width: 0,
            height: 20,
        },
        shadowOpacity: theme.dark ? 0.55 : 0.25,
        shadowRadius: 40,
        elevation: 20,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    footer: {
        minHeight: 32,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    footerStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    footerSpinner: {
        transform: [{ scale: 0.7 }],
    },
    footerHints: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    footerText: {
        color: theme.colors.textSecondary,
        fontSize: 11,
    },
}));
