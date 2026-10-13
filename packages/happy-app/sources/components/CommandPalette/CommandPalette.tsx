import React from 'react';
import { ActivityIndicator, Text, View, Platform, Pressable, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { CommandPaletteInput } from './CommandPaletteInput';
import { CommandPaletteResults } from './CommandPaletteResults';
import { CommandPaletteHistory } from './CommandPaletteHistory';
import { useCommandPalette } from './useCommandPalette';
import { Command } from './types';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Home', 'End']);

interface CommandPaletteProps {
    commands: Command[];
    searchCachedMessages?: (query: string) => Promise<CachedMessageSearchMatch[]>;
    // Hides the palette and keeps its state, for clicking outside or after running a result
    onClose: () => void;
    // Esc on an empty query; the palette starts fresh next time
    onDismiss?: () => void;
    visible?: boolean;
    // Off while another modal sits on top, so Esc only reaches that one
    escapeEnabled?: boolean;
}

export function CommandPalette({ commands, searchCachedMessages, onClose, onDismiss, visible = true, escapeEnabled = true }: CommandPaletteProps) {
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
        executingCommandId,
        isSearchingMessages,
        searchHistory,
        isHistoryOpen,
        historyIndex,
        resultsAnchorRef,
        historyAnchorRef,
        toggleHistory,
        closeHistory,
        selectHistoryEntry,
        removeHistoryEntry,
        clearHistory,
    } = useCommandPalette(commands, onClose, searchCachedMessages, tileColumns, onDismiss);

    // The palette stays mounted while hidden; typing should land in the input whenever it shows again
    React.useEffect(() => {
        if (!visible) {
            // Hidden but still mounted: keystrokes must not keep landing in it
            inputRef.current?.blur();
            return;
        }
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [visible, inputRef]);

    // The keys work wherever focus is — clicking a history entry or a row takes it out of the input.
    // Esc leaves the history list, then clears the query, then closes. Captured, because
    // react-native-web's TextInput stops every keydown from bubbling past it
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !visible || !escapeEnabled) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                handleKeyPress('Escape');
                return;
            }
            // The input handles its own keys, and other text fields keep theirs
            const target = event.target as HTMLElement | null;
            if (!NAVIGATION_KEYS.has(event.key) || !target || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (handleKeyPress(event.key)) {
                // Also keeps a focused row from treating Enter as its own press
                event.preventDefault();
                event.stopPropagation();
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [visible, escapeEnabled, handleKeyPress]);

    // Back to the input after picking a history entry, so typing refines the search
    const handleSelectHistoryEntry = React.useCallback((entry: string) => {
        selectHistoryEntry(entry);
        inputRef.current?.focus();
    }, [selectHistoryEntry, inputRef]);

    const resultCount = React.useMemo(
        // A message group's heading and "N more" row are not results of their own
        () => filteredCategories.reduce(
            (count, category) => count + category.commands.filter((command) => command.layout !== 'messageGroup' && command.layout !== 'messageMore').length,
            0,
        ),
        [filteredCategories],
    );

    // The history dropdown hangs from the bottom of the input, over the results
    const [inputHeight, setInputHeight] = React.useState(0);

    return (
        <View style={styles.wrapper}>
            <View style={[styles.container, Platform.OS !== 'web' && { maxHeight: height * 0.8 }]}>
                <View onLayout={(event) => setInputHeight(event.nativeEvent.layout.height)}>
                    <CommandPaletteInput
                        value={searchQuery}
                        onChangeText={handleSearchChange}
                        onKeyPress={handleKeyPress}
                        inputRef={inputRef}
                        hasHistory={searchHistory.length > 0}
                        isHistoryOpen={isHistoryOpen}
                        onToggleHistory={toggleHistory}
                    />
                </View>
                <CommandPaletteResults
                    categories={filteredCategories}
                    selectedIndex={selectedIndex}
                    onSelectCommand={handleSelectCommand}
                    anchorRef={resultsAnchorRef}
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
                        <Text style={[styles.footerText, Typography.default()]}>{searchQuery ? t('commandPalette.clearHint') : t('commandPalette.closeHint')}</Text>
                    </View>}
                </View>
            </View>
            {isHistoryOpen && <>
                {/* A click anywhere else in the palette closes the dropdown */}
                <Pressable style={styles.historyBackdrop} onPress={closeHistory} accessible={false} />
                <View style={[styles.historyDropdown, { top: inputHeight + 4 }]}>
                    <CommandPaletteHistory
                        history={searchHistory}
                        selectedIndex={historyIndex}
                        onSelect={handleSelectHistoryEntry}
                        anchorRef={historyAnchorRef}
                        onRemove={removeHistoryEntry}
                        onClear={clearHistory}
                    />
                </View>
            </>}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    // Not clipped like the panel, so the history dropdown can reach past a short result list
    wrapper: {
        width: '100%',
        maxWidth: 800,
    },
    historyBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    historyDropdown: {
        position: 'absolute',
        right: 10,
        width: 360,
        maxWidth: '90%',
    },
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
