import * as React from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { BottomSheetModal, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { SearchField } from '@/components/SearchField';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { machineBash } from '@/sync/ops';
import * as Clipboard from 'expo-clipboard';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { sheetFill } from '@/components/glassSheet';

interface FolderPickerSheetProps {
    machineId: string;
    homeDir?: string;
    /** Where to open, when that should be somewhere other than the home directory. */
    initialPath?: string;
    /** 'directory' (default) picks folders; 'file' picks individual files. */
    mode?: 'directory' | 'file';
    onSelect: (path: string) => void;
    /** Multi-select callback for file mode. When provided, files are toggled instead of immediately selected. */
    onFileSelect?: (paths: string[]) => void;
    /** Initial selection of absolute file paths for multi-select mode. */
    initialSelection?: string[];
}

/** Separates the directory list from the git repos in one command's output. */
const GIT_MARKER = '---happy-git-repos---';

interface DirEntry {
    name: string;
    isGitRepo: boolean;
    isDir: boolean;
}

/**
 * BottomSheet-based directory browser for picking folders on a remote machine.
 *
 * Behaviour:
 *  - Lists only directories (hidden files excluded).
 *  - Detects git repos up to 2 levels deep and shows a badge.
 *  - Search field filters entries by name; typing an absolute or ~/… path
 *    and pressing Enter navigates to that path.
 *  - "Select" button in nav bar confirms the current directory.
 *  - Back button in nav bar navigates to the parent directory.
 */
export const FolderPickerSheet = React.memo(React.forwardRef<BottomSheetModal, FolderPickerSheetProps>(({
    machineId,
    homeDir = '/',
    initialPath,
    mode = 'directory',
    onSelect,
    onFileSelect,
    initialSelection,
}, ref) => {
    const isFileMode = mode === 'file';
    const { theme } = useUnistyles();

    // ---- state ----
    // Where the sheet opens. Only the starting point moves: `~` still means the
    // home directory, and the home button still goes there.
    const startPath = initialPath ?? homeDir;

    const [currentPath, setCurrentPath] = React.useState(startPath);
    const [entries, setEntries] = React.useState<DirEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [search, setSearch] = React.useState('');
    const [selectedFiles, setSelectedFiles] = React.useState<Set<string>>(new Set());
    const fetchIdRef = React.useRef(0);

    // ---- helpers ----

    /** Resolve ~ to homeDir for client-side path operations. */
    const resolvePath = React.useCallback((path: string) => {
        if (path === '~') return homeDir;
        if (path.startsWith('~/')) return homeDir + path.slice(1);
        return path;
    }, [homeDir]);

    /**
     * Loads `dirPath` and, once it has loaded, shows it: the path, the list and
     * the back button change in one render, so the old list never sits under
     * the new path while the machine answers.
     */
    const fetchDirectory = React.useCallback(async (dirPath: string) => {
        const id = ++fetchIdRef.current;
        setLoading(true);
        const show = (next: DirEntry[], nextError: string | null) => {
            setCurrentPath(dirPath);
            setEntries(next);
            setError(nextError);
            setSearch('');
        };
        try {
            if (isFileMode) {
                // File mode: list files and directories
                const lsResult = await machineBash(machineId, "ls -1ap", dirPath);
                if (id !== fetchIdRef.current) return;
                if (!lsResult.success) {
                    show([], t('newSession.repos.folderPicker.loadError'));
                    return;
                }
                const lines = lsResult.stdout.split('\n').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('.'));
                const dirs: DirEntry[] = [];
                const files: DirEntry[] = [];
                for (const line of lines) {
                    if (line.endsWith('/')) {
                        dirs.push({ name: line.replace(/\/$/, ''), isGitRepo: false, isDir: true });
                    } else {
                        files.push({ name: line, isGitRepo: false, isDir: false });
                    }
                }
                dirs.sort((a, b) => a.name.localeCompare(b.name));
                files.sort((a, b) => a.name.localeCompare(b.name));
                show([...dirs, ...files], null);
            } else {
                // Directory mode: list only directories, and in the same round
                // trip the ones that are git repos (up to 2 levels deep)
                const result = await machineBash(
                    machineId,
                    "dirs=$(ls -1ap) || exit 1; " +
                    "printf '%s\\n' \"$dirs\" | grep '/$' | sed 's/\\/$//'; " +
                    `echo '${GIT_MARKER}'; ` +
                    "find . -maxdepth 2 -name '.git' -type d 2>/dev/null | sed 's|^\\./||' | sed 's|/\\.git$||'",
                    dirPath,
                );
                if (id !== fetchIdRef.current) return;
                if (!result.success) {
                    show([], t('newSession.repos.folderPicker.loadError'));
                    return;
                }

                const lines = result.stdout.split('\n').map(s => s.trim());
                const marker = lines.indexOf(GIT_MARKER);
                const dirNames = (marker === -1 ? lines : lines.slice(0, marker))
                    .filter(s => s.length > 0 && !s.startsWith('.'));
                const gitSet = new Set(
                    marker === -1 ? [] : lines.slice(marker + 1).filter(s => s.length > 0),
                );

                const parsed: DirEntry[] = dirNames.map(name => ({
                    name,
                    isGitRepo: gitSet.has(name),
                    isDir: true,
                }));

                parsed.sort((a, b) => {
                    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });

                show(parsed, null);
            }
        } catch {
            if (id !== fetchIdRef.current) return;
            show([], t('newSession.repos.folderPicker.loadError'));
        } finally {
            if (id === fetchIdRef.current) setLoading(false);
        }
    }, [machineId, isFileMode]);

    // Navigate to a new directory; the current one stays on screen until it loads
    const navigateTo = fetchDirectory;

    // A newly shown directory starts at its top
    const listRef = React.useRef<React.ElementRef<typeof BottomSheetFlatList>>(null);
    React.useLayoutEffect(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, [currentPath]);

    // ---- sheet lifecycle ----

    const handleAnimate = React.useCallback((from: number, to: number) => {
        if (from === -1 && to === 0) {
            setSelectedFiles(initialSelection?.length ? new Set(initialSelection) : new Set());
            // Opening starts clean rather than on what was listed last time
            setCurrentPath(startPath);
            setEntries([]);
            setError(null);
            navigateTo(startPath);
        }
    }, [initialSelection, navigateTo, startPath]);

    const handleDismiss = React.useCallback(() => {
        setSearch('');
    }, []);

    // ---- navigation actions ----

    const goHome = React.useCallback(() => {
        navigateTo(homeDir);
    }, [homeDir, navigateTo]);

    const goUp = React.useCallback(() => {
        if (currentPath === '/') return;
        // Resolve parent: strip trailing /, then take dirname
        const clean = currentPath.replace(/\/+$/, '');
        const lastSlash = clean.lastIndexOf('/');
        const parent = lastSlash <= 0 ? '/' : clean.substring(0, lastSlash);
        navigateTo(parent);
    }, [currentPath, navigateTo]);

    const handleEntryPress = React.useCallback((item: DirEntry) => {
        const next = currentPath === '/'
            ? '/' + item.name
            : currentPath.replace(/\/+$/, '') + '/' + item.name;
        if (isFileMode && !item.isDir) {
            if (onFileSelect) {
                // Multi-select: toggle file in set
                setSelectedFiles(prev => {
                    const updated = new Set(prev);
                    if (updated.has(next)) updated.delete(next);
                    else updated.add(next);
                    return updated;
                });
                return;
            }
            // Single-select fallback
            onSelect(next);
            if (ref && typeof ref !== 'function' && ref.current) {
                ref.current.dismiss();
            }
            return;
        }
        navigateTo(next);
    }, [currentPath, navigateTo, isFileMode, onSelect, onFileSelect, ref]);

    const handleSelect = React.useCallback(() => {
        onSelect(currentPath);
        if (ref && typeof ref !== 'function' && ref.current) {
            ref.current.dismiss();
        }
    }, [currentPath, onSelect, ref]);

    const handleConfirmFiles = React.useCallback(() => {
        if (onFileSelect && selectedFiles.size > 0) {
            onFileSelect([...selectedFiles]);
            if (ref && typeof ref !== 'function' && ref.current) {
                ref.current.dismiss();
            }
        }
    }, [selectedFiles, onFileSelect, ref]);

    const handleCopyPath = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(currentPath);
            hapticsLight(); showCopiedToast();
        } catch {}
    }, [currentPath]);

    // ---- search / path jump ----

    const handleSearchSubmit = React.useCallback(() => {
        const trimmed = search.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
            navigateTo(resolvePath(trimmed));
        }
    }, [search, navigateTo, resolvePath]);

    const clearSearch = React.useCallback(() => {
        setSearch('');
    }, []);

    // ---- filtered entries ----

    const filtered = React.useMemo(() => {
        if (!search.trim() || search.startsWith('/') || search.startsWith('~')) return entries;
        const q = search.toLowerCase();
        return entries.filter(e => e.name.toLowerCase().includes(q));
    }, [entries, search]);

    // ---- rendering ----


    // Format path for display: substitute homeDir with ~, then truncate if needed
    const displayPath = React.useMemo(() => {
        let display = currentPath;
        if (homeDir && homeDir !== '/' && currentPath.startsWith(homeDir)) {
            display = '~' + currentPath.slice(homeDir.length);
            if (display === '~') display = '~/';
        }
        if (display.length <= 40) return display;
        return '...' + display.slice(-37);
    }, [currentPath, homeDir]);

    const isAtHome = currentPath === homeDir;
    const isAtRoot = currentPath === '/' || isAtHome;

    const renderItem = React.useCallback(({ item }: { item: DirEntry }) => {
        const fullPath = currentPath === '/'
            ? '/' + item.name
            : currentPath.replace(/\/+$/, '') + '/' + item.name;
        const isSelected = isFileMode && !item.isDir && selectedFiles.has(fullPath);

        const iconName = item.isDir
            ? (item.isGitRepo ? 'git-branch' : 'folder')
            : (isFileMode && onFileSelect)
                ? (isSelected ? 'checkbox' : 'square-outline')
                : 'document-outline';
        const iconColor = isSelected
            ? theme.colors.textLink
            : item.isGitRepo
                ? theme.colors.success
                : theme.colors.textSecondary;

        return (
            <Pressable
                style={({ pressed }) => [
                    itemStyles.row,
                    pressed && { backgroundColor: sheetFill(theme.colors.surface) },
                ]}
                onPress={() => handleEntryPress(item)}
            >
                <Ionicons name={iconName} size={20} color={iconColor} />
                <Text style={[itemStyles.name, { color: theme.colors.text }]} numberOfLines={1}>
                    {item.name}
                </Text>
                {item.isGitRepo && (
                    <View style={[itemStyles.badge, { backgroundColor: theme.colors.success }]}>
                        <Text style={itemStyles.badgeText}>{t('newSession.repos.folderPicker.gitRepo')}</Text>
                    </View>
                )}
                {item.isDir && (
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                )}
            </Pressable>
        );
    }, [theme, handleEntryPress, currentPath, isFileMode, selectedFiles, onFileSelect]);

    const keyExtractor = React.useCallback((item: DirEntry) => item.name, []);

    const ListEmptyComponent = React.useMemo(() => {
        if (loading) return null;
        return (
            <View style={emptyStyles.container}>
                <Text style={[emptyStyles.text, { color: theme.colors.textSecondary }]}>
                    {error || t('newSession.repos.folderPicker.emptyFolder')}
                </Text>
            </View>
        );
    }, [loading, error, theme]);

    return (
        <AppBottomSheet
            ref={ref}
            snapPoints={['75%']}
            enableDynamicSizing={false}
            onAnimate={handleAnimate}
            onDismiss={handleDismiss}
        >
            <View style={{ flex: 1 }}>
                {/* Title */}
                <Text style={[headerStyles.title, { color: theme.colors.text }]}>
                    {isFileMode ? t('newSession.repos.folderPicker.selectFile') : t('newSession.repos.folderPicker.title')}
                </Text>

                {/* Pinned navigation bar */}
                <View style={[headerStyles.navBar, { borderBottomColor: theme.colors.divider }]}>
                    {/* Up a level lives here rather than as a row atop the list, so the list never shifts */}
                    <View style={headerStyles.navSide}>
                        <Pressable onPress={goUp} disabled={isAtRoot} hitSlop={8} style={headerStyles.navButton}>
                            <Ionicons
                                name="chevron-back"
                                size={22}
                                color={isAtRoot ? theme.colors.textSecondary : theme.colors.textLink}
                                style={isAtRoot && { opacity: 0.4 }}
                            />
                        </Pressable>
                        <Pressable onPress={goHome} disabled={isAtHome} hitSlop={8} style={headerStyles.navButton}>
                            <Ionicons
                                name="home"
                                size={20}
                                color={isAtHome ? theme.colors.textSecondary : theme.colors.textLink}
                                style={isAtHome && { opacity: 0.4 }}
                            />
                        </Pressable>
                    </View>
                    <Pressable onLongPress={handleCopyPath} style={{ flex: 1 }}>
                        <Text style={[headerStyles.pathText, { color: theme.colors.text }]} numberOfLines={1}>
                            {displayPath}
                        </Text>
                    </Pressable>
                    {/* As wide as the left side, so the path sits in the middle */}
                    <View style={[headerStyles.navSide, { justifyContent: 'flex-end' }]}>
                        <View style={headerStyles.navButton}>
                            {loading ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : !isFileMode ? (
                                <Pressable onPress={handleSelect} hitSlop={8}>
                                    <Ionicons name="checkmark-circle" size={24} color={theme.colors.textLink} />
                                </Pressable>
                            ) : onFileSelect ? (
                                <Pressable
                                    onPress={handleConfirmFiles}
                                    disabled={selectedFiles.size === 0}
                                    hitSlop={8}
                                    style={{ position: 'relative' }}
                                >
                                    <Ionicons
                                        name="checkmark-circle"
                                        size={24}
                                        color={selectedFiles.size > 0 ? theme.colors.textLink : theme.colors.textSecondary}
                                    />
                                    {selectedFiles.size > 0 && (
                                        <View style={{
                                            position: 'absolute', top: -6, right: -8,
                                            backgroundColor: theme.colors.button.primary.background,
                                            borderRadius: 8, minWidth: 16, height: 16,
                                            alignItems: 'center', justifyContent: 'center',
                                            paddingHorizontal: 4,
                                        }}>
                                            <Text style={{ fontSize: 10, color: theme.colors.button.primary.tint, fontWeight: '700' }}>
                                                {selectedFiles.size}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                </View>

                {/* Pinned search / path input */}
                <SearchField
                    inSheet
                    value={search}
                    onChangeText={setSearch}
                    onClear={clearSearch}
                    onSubmitEditing={handleSearchSubmit}
                    returnKeyType="go"
                    placeholder={t('newSession.repos.folderPicker.searchPlaceholder')}
                    style={headerStyles.searchField}
                />

                <BottomSheetFlatList
                    ref={listRef}
                    data={filtered}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    ListEmptyComponent={ListEmptyComponent}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    keyboardShouldPersistTaps="handled"
                />
            </View>
        </AppBottomSheet>
    );
}));

// ---- Styles ----

const NAV_BUTTON_SIZE = 32;
const NAV_SIDE_GAP = 4;

const headerStyles = StyleSheet.create((theme) => ({
    title: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        textAlign: 'center',
        paddingVertical: theme.margins.sm,
    },
    navBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: theme.margins.lg,
        paddingVertical: theme.margins.sm,
        borderBottomWidth: 1,
        gap: theme.margins.sm,
    },
    navSide: {
        width: NAV_BUTTON_SIZE * 2 + NAV_SIDE_GAP,
        flexDirection: 'row',
        alignItems: 'center',
        gap: NAV_SIDE_GAP,
    },
    navButton: {
        width: NAV_BUTTON_SIZE,
        height: NAV_BUTTON_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pathText: {
        ...Typography.mono(),
        fontSize: 13,
        textAlign: 'center',
    },
    searchField: {
        marginHorizontal: theme.margins.lg,
        marginVertical: theme.margins.md,
    },
}));

const itemStyles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: theme.margins.lg,
        paddingVertical: 12,
        gap: 12,
    },
    name: {
        ...Typography.default(),
        fontSize: 15,
        flex: 1,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeText: {
        ...Typography.default('semiBold'),
        fontSize: 11,
        color: '#FFFFFF',
    },
}));

const emptyStyles = StyleSheet.create((_theme) => ({
    container: {
        alignItems: 'center',
        paddingTop: 40,
        paddingHorizontal: _theme.margins.lg,
    },
    text: {
        ...Typography.default(),
        fontSize: 14,
        textAlign: 'center',
    },
}));
