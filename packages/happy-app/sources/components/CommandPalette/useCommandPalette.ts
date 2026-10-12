import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { TextInput } from 'react-native';
import { Command } from './types';
import { applyCachedMessageMatches, buildNavigationRows, groupCommands } from './search';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

export function useCommandPalette(
    commands: Command[],
    onClose: () => void,
    searchCachedMessages?: (query: string) => Promise<CachedMessageSearchMatch[]>,
    tileColumns = 4,
) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [executingCommandId, setExecutingCommandId] = useState<string | null>(null);
    const [cachedMessageMatches, setCachedMessageMatches] = useState<CachedMessageSearchMatch[]>([]);
    const [isSearchingMessages, setIsSearchingMessages] = useState(false);
    const inputRef = useRef<TextInput>(null);

    // Filter commands based on search query
    useEffect(() => {
        const query = searchQuery.trim();
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        setCachedMessageMatches([]);
        if (!searchCachedMessages || query.length < 2) {
            setIsSearchingMessages(false);
            return () => {};
        }

        setIsSearchingMessages(true);
        timer = setTimeout(() => {
            searchCachedMessages(query)
                .then((matches) => {
                    if (!cancelled) setCachedMessageMatches(matches);
                })
                .catch((error) => {
                    console.warn('[CommandPalette] Cached message search failed:', error);
                })
                .finally(() => {
                    if (!cancelled) setIsSearchingMessages(false);
                });
        }, 200);

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [searchCachedMessages, searchQuery]);

    const searchableCommands = useMemo(() => {
        return applyCachedMessageMatches(
            commands,
            cachedMessageMatches,
            searchQuery,
            t('commandPalette.messageMatch'),
        );
    }, [cachedMessageMatches, commands, searchQuery]);

    const filteredCategories = useMemo(
        () => groupCommands(searchableCommands, searchQuery),
        [searchableCommands, searchQuery],
    );

    // Reset selection when search changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchQuery]);

    const handleSelectCommand = useCallback(async (command: Command) => {
        if (executingCommandId) return;
        setExecutingCommandId(command.id);
        try {
            await command.action();
            onClose();
        } catch (error) {
            console.error('[CommandPalette] Command failed:', command.id, error);
            showToast(t('commandPalette.actionFailed'), { icon: 'alert-circle-outline' });
            setExecutingCommandId(null);
        }
    }, [executingCommandId, onClose]);

    // Get flattened commands for keyboard navigation
    const allCommands = useMemo(() => {
        return filteredCategories.flatMap(cat => cat.commands);
    }, [filteredCategories]);

    const navigationRows = useMemo(
        () => buildNavigationRows(filteredCategories, searchQuery, tileColumns),
        [filteredCategories, searchQuery, tileColumns],
    );

    useEffect(() => {
        setSelectedIndex((current) => Math.min(current, Math.max(allCommands.length - 1, 0)));
    }, [allCommands.length]);

    // Up/down move by row, keeping the column when moving between tile rows
    const moveVertically = useCallback((step: 1 | -1) => {
        setSelectedIndex((current) => {
            const rowIndex = navigationRows.findIndex((row) => row.includes(current));
            const target = navigationRows[rowIndex + step];
            if (rowIndex === -1 || !target) return current;
            const column = navigationRows[rowIndex].indexOf(current);
            return target[Math.min(column, target.length - 1)];
        });
    }, [navigationRows]);

    // Returns whether the key was handled, so the input only swallows keys the palette acts on
    const handleKeyPress = useCallback((key: string): boolean => {
        switch(key) {
            case 'Escape':
                onClose();
                return true;
            case 'ArrowDown':
                moveVertically(1);
                return true;
            case 'ArrowUp':
                moveVertically(-1);
                return true;
            case 'ArrowLeft':
            case 'ArrowRight': {
                // With text in the input, left/right keep moving the caret
                if (searchQuery.trim()) return false;
                const step = key === 'ArrowRight' ? 1 : -1;
                setSelectedIndex(Math.min(Math.max(selectedIndex + step, 0), Math.max(allCommands.length - 1, 0)));
                return true;
            }
            case 'Home':
                setSelectedIndex(0);
                return true;
            case 'End':
                setSelectedIndex(Math.max(allCommands.length - 1, 0));
                return true;
            case 'Enter':
                if (allCommands[selectedIndex]) {
                    handleSelectCommand(allCommands[selectedIndex]);
                }
                return true;
        }
        return false;
    }, [onClose, moveVertically, searchQuery, allCommands, selectedIndex, handleSelectCommand]);

    const handleSearchChange = useCallback((text: string) => {
        setSearchQuery(text);
    }, []);

    return {
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
    };
}
