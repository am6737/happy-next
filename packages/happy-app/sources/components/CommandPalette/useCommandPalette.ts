import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { TextInput } from 'react-native';
import { Command } from './types';
import type { NavigationAnchor } from './navigationAnchor';
import { buildMessageCategory, buildNavigationRows, groupCommands } from './search';
import { addSearchHistoryEntry, loadSearchHistory, saveSearchHistory } from './searchHistory';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

export function useCommandPalette(
    commands: Command[],
    onClose: () => void,
    searchCachedMessages?: (query: string) => Promise<CachedMessageSearchMatch[]>,
    tileColumns = 4,
    // Esc on an empty query; defaults to onClose
    onDismiss: () => void = onClose,
) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [executingCommandId, setExecutingCommandId] = useState<string | null>(null);
    const [cachedMessageMatches, setCachedMessageMatches] = useState<CachedMessageSearchMatch[]>([]);
    const [isSearchingMessages, setIsSearchingMessages] = useState(false);
    // Sessions whose folded message hits were expanded; a new query folds them all again
    const [expandedSessionIds, setExpandedSessionIds] = useState<ReadonlySet<string>>(new Set());
    const inputRef = useRef<TextInput>(null);
    const [searchHistory, setSearchHistory] = useState<string[]>(loadSearchHistory);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(0);
    // Set by the results and the history list: the row the arrow keys start from instead of the selection
    const resultsAnchorRef = useRef<NavigationAnchor | null>(null);
    const historyAnchorRef = useRef<NavigationAnchor | null>(null);

    const updateSearchHistory = useCallback((update: (history: string[]) => string[]) => {
        setSearchHistory((current) => {
            const next = update(current);
            if (next !== current) saveSearchHistory(next);
            return next;
        });
    }, []);

    // A new query starts from the top, with no stale message hits or expanded groups
    const changeQuery = useCallback((query: string) => {
        setSearchQuery(query);
        setSelectedIndex(0);
        setCachedMessageMatches([]);
        setExpandedSessionIds(new Set());
    }, []);

    // Filter commands based on search query
    useEffect(() => {
        const query = searchQuery.trim();
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

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

    const expandSession = useCallback((sessionId: string) => {
        setExpandedSessionIds((current) => new Set(current).add(sessionId));
    }, []);

    const messageCategory = useMemo(() => buildMessageCategory(
        commands,
        cachedMessageMatches,
        {
            category: t('commandPalette.categoryMessages'),
            badge: t('commandPalette.messageMatch'),
            user: t('commandPalette.messageFromUser'),
            agent: t('commandPalette.messageFromAgent'),
            more: (count) => t('commandPalette.moreMessageMatches', { count }),
        },
        expandedSessionIds,
        expandSession,
    ), [cachedMessageMatches, commands, expandedSessionIds, expandSession]);

    const filteredCategories = useMemo(
        () => groupCommands(commands, searchQuery, messageCategory),
        [commands, searchQuery, messageCategory],
    );

    const handleSelectCommand = useCallback(async (command: Command) => {
        if (executingCommandId) return;
        if (command.keepOpen) {
            await command.action();
            return;
        }
        updateSearchHistory((history) => addSearchHistoryEntry(history, searchQuery));
        setExecutingCommandId(command.id);
        try {
            await command.action();
            onClose();
        } catch (error) {
            console.error('[CommandPalette] Command failed:', command.id, error);
            showToast(t('commandPalette.actionFailed'), { icon: 'alert-circle-outline' });
        } finally {
            // The palette is only hidden, not unmounted, so the row must be usable again next time
            setExecutingCommandId(null);
        }
    }, [executingCommandId, onClose, searchQuery, updateSearchHistory]);

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
        const anchor = resultsAnchorRef.current?.() ?? null;
        if (anchor !== null) {
            setSelectedIndex(anchor);
            return;
        }
        setSelectedIndex((current) => {
            const rowIndex = navigationRows.findIndex((row) => row.includes(current));
            const target = navigationRows[rowIndex + step];
            if (rowIndex === -1 || !target) return current;
            const column = navigationRows[rowIndex].indexOf(current);
            return target[Math.min(column, target.length - 1)];
        });
    }, [navigationRows]);

    const toggleHistory = useCallback(() => {
        setHistoryIndex(0);
        setIsHistoryOpen((open) => !open && searchHistory.length > 0);
    }, [searchHistory.length]);

    const closeHistory = useCallback(() => setIsHistoryOpen(false), []);

    const selectHistoryEntry = useCallback((entry: string) => {
        changeQuery(entry);
        setIsHistoryOpen(false);
    }, [changeQuery]);

    const removeHistoryEntry = useCallback((entry: string) => {
        updateSearchHistory((history) => history.filter((item) => item !== entry));
        setHistoryIndex((index) => Math.max(0, Math.min(index, searchHistory.length - 2)));
        if (searchHistory.length <= 1) setIsHistoryOpen(false);
    }, [searchHistory.length, updateSearchHistory]);

    const clearHistory = useCallback(() => {
        updateSearchHistory(() => []);
        setIsHistoryOpen(false);
    }, [updateSearchHistory]);

    // While the history list is showing, the keys drive it instead of the results
    const handleHistoryKeyPress = useCallback((key: string): boolean => {
        switch(key) {
            case 'Escape':
                setIsHistoryOpen(false);
                return true;
            case 'ArrowDown':
            case 'ArrowUp': {
                const anchor = historyAnchorRef.current?.() ?? null;
                const step = key === 'ArrowDown' ? 1 : -1;
                setHistoryIndex((index) => anchor ?? Math.min(Math.max(index + step, 0), searchHistory.length - 1));
                return true;
            }
            case 'Enter':
                if (searchHistory[historyIndex]) selectHistoryEntry(searchHistory[historyIndex]);
                return true;
        }
        return false;
    }, [historyIndex, searchHistory, selectHistoryEntry]);

    // Returns whether the key was handled, so the input only swallows keys the palette acts on
    const handleKeyPress = useCallback((key: string): boolean => {
        if (isHistoryOpen) return handleHistoryKeyPress(key);
        switch(key) {
            case 'Escape':
                // Esc clears the query first, and closes the palette once it is empty
                if (searchQuery) changeQuery('');
                else onDismiss();
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
                const anchor = resultsAnchorRef.current?.() ?? null;
                setSelectedIndex(anchor ?? Math.min(Math.max(selectedIndex + step, 0), Math.max(allCommands.length - 1, 0)));
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
    }, [isHistoryOpen, handleHistoryKeyPress, onDismiss, moveVertically, searchQuery, allCommands, selectedIndex, handleSelectCommand]);

    const handleSearchChange = useCallback((text: string) => {
        changeQuery(text);
        setIsHistoryOpen(false);
    }, [changeQuery]);

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
    };
}
