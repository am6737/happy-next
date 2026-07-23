import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { TextInput } from 'react-native';
import { Command } from './types';
import { applyCachedMessageMatches, groupCommands } from './search';
import { showToast } from '@/components/Toast';
import { t } from '@/text';
import type { CachedMessageSearchMatch } from '@/sync/messagesStore/cachedMessageSearch';

export function useCommandPalette(
    commands: Command[],
    onClose: () => void,
    searchCachedMessages?: (query: string) => Promise<CachedMessageSearchMatch[]>,
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

    useEffect(() => {
        setSelectedIndex((current) => Math.min(current, Math.max(allCommands.length - 1, 0)));
    }, [allCommands.length]);

    const handleKeyPress = useCallback((key: string) => {
        switch(key) {
            case 'Escape':
                onClose();
                break;
            case 'ArrowDown':
                setSelectedIndex(prev => Math.min(prev + 1, Math.max(allCommands.length - 1, 0)));
                break;
            case 'ArrowUp':
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Home':
                setSelectedIndex(0);
                break;
            case 'End':
                setSelectedIndex(Math.max(allCommands.length - 1, 0));
                break;
            case 'Enter':
                if (allCommands[selectedIndex]) {
                    handleSelectCommand(allCommands[selectedIndex]);
                }
                break;
        }
    }, [onClose, allCommands, selectedIndex, handleSelectCommand]);

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
