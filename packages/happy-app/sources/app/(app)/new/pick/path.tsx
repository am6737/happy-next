import React, { useState, useMemo, useRef } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { Typography } from '@/constants/Typography';
import { useAllMachines, useSessions, useSetting } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { MultiTextInput, MultiTextInputHandle } from '@/components/MultiTextInput';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { useDirectoryCompletions } from '@/utils/pathCompletion';
import { useKeyboardState } from 'react-native-keyboard-controller';

const MAX_COMPLETIONS = 8;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContainer: {
        flex: 1,
    },
    scrollContent: {
        alignItems: 'center',
    },
    contentWrapper: {
        width: '100%',
        maxWidth: layout.maxWidth,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    // The field stands on the background by itself, no card around it: its edges are the list
    // card's below, and it takes the card's surface so it still reads as a field on the grey.
    // Its title's centre stands as far under the header as the inbox's first section title's: 34, its
    // 12 top padding plus the middle of a 44 row.
    pathInputHeader: {
        paddingTop: 34 - Platform.select({ ios: 18, default: 20 }) / 2,
    },
    pathInputGroup: {
        backgroundColor: 'transparent',
        shadowOpacity: 0,
        elevation: 0,
        overflow: 'visible',
    },
    pathInput: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: Platform.select({ ios: 10, default: 16 }),
        paddingHorizontal: 16,
        paddingVertical: 7,
        minHeight: 52,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    pathInputField: {
        flex: 1,
    },
    pathInputSpinner: {
        marginLeft: 10,
        transform: [{ scale: 0.8 }],
    },
    pathIconSlot: {
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

export default function PathPickerScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const navigation = useNavigation();
    const params = useLocalSearchParams<{ machineId?: string; selectedPath?: string }>();
    const machines = useAllMachines();
    const sessions = useSessions();
    const inputRef = useRef<MultiTextInputHandle>(null);
    const recentMachinePaths = useSetting('recentMachinePaths');
    // The list makes room for the keyboard by an inset of its own: iOS's automatic keyboard insets
    // also move the scroll offset, and under the soft header they leave the field behind it.
    const keyboardHeight = useKeyboardState((state) => state.height);
    const keyboardInset = React.useMemo(() => ({ bottom: Platform.OS === 'ios' ? keyboardHeight : 0 }), [keyboardHeight]);

    const [customPath, setCustomPath] = useState(() => {
        if (!params.selectedPath) return '';
        const m = machines.find(m => m.id === params.machineId);
        return formatPathRelativeToHome(params.selectedPath, m?.metadata?.homeDir);
    });
    const [isInputFocused, setIsInputFocused] = useState(false);

    const machine = useMemo(() => {
        return machines.find(m => m.id === params.machineId);
    }, [machines, params.machineId]);

    const recentPaths = useMemo(() => {
        if (!params.machineId) return [];

        const paths: string[] = [];
        const pathSet = new Set<string>();

        recentMachinePaths.forEach(entry => {
            if (entry.machineId === params.machineId && !pathSet.has(entry.path)) {
                paths.push(entry.path);
                pathSet.add(entry.path);
            }
        });

        if (sessions) {
            const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];

            sessions.forEach(item => {
                if (typeof item === 'string') return;

                const session = item as any;
                if (session.metadata?.machineId === params.machineId && session.metadata?.path) {
                    const path = session.metadata.path;
                    if (!pathSet.has(path)) {
                        pathSet.add(path);
                        pathsWithTimestamps.push({
                            path,
                            timestamp: session.updatedAt || session.createdAt
                        });
                    }
                }
            });

            pathsWithTimestamps
                .sort((a, b) => b.timestamp - a.timestamp)
                .forEach(item => paths.push(item.path));
        }

        return paths;
    }, [sessions, params.machineId, recentMachinePaths]);

    const homeDir = machine?.metadata?.homeDir;

    const defaultSuggestedPaths = React.useMemo(() => ['~', '~/projects', '~/Documents', '~/Desktop'], []);

    const recentPathDisplays = React.useMemo(() => {
        return recentPaths.slice(0, MAX_COMPLETIONS).map((path) => formatPathRelativeToHome(path, homeDir));
    }, [homeDir, recentPaths]);

    const recentPathMatches = React.useMemo(() => {
        const query = customPath.trim().toLowerCase();
        if (!query) return recentPathDisplays;
        return recentPaths
            .map((path) => formatPathRelativeToHome(path, homeDir))
            .filter((path) => {
                return path.toLowerCase().includes(query)
                    || resolveAbsolutePath(path, homeDir).toLowerCase().includes(query);
            })
            .slice(0, MAX_COMPLETIONS);
    }, [customPath, homeDir, recentPathDisplays, recentPaths]);

    const { completions: directoryCompletions, loading: isLoadingCompletions } = useDirectoryCompletions({
        machineId: params.machineId,
        input: customPath,
        homeDir,
        enabled: isInputFocused,
    });

    const recommendedPaths = React.useMemo(() => {
        const defaultList = recentPathDisplays.length > 0 ? recentPathDisplays : defaultSuggestedPaths;
        const trimmed = customPath.trim();

        if (!isInputFocused || !trimmed) return defaultList;

        const baseList = directoryCompletions.length > 0 ? directoryCompletions : recentPathMatches;
        if (baseList.includes(trimmed)) return baseList;
        return [trimmed, ...baseList];
    }, [
        customPath,
        defaultSuggestedPaths,
        directoryCompletions,
        isInputFocused,
        recentPathDisplays,
        recentPathMatches,
    ]);

    const recommendedTitle = isInputFocused && customPath.trim()
        ? t('wizard.directorySuggestions')
        : recentPaths.length > 0 ? t('wizard.recentPaths') : t('wizard.suggestedPaths');

    const renderPathIcon = React.useCallback(() => (
        <View style={styles.pathIconSlot}>
            <Ionicons
                name="folder-outline"
                size={18}
                color={theme.colors.textSecondary}
            />
        </View>
    ), [styles.pathIconSlot, theme.colors.textSecondary]);

    const handleSelectPath = React.useCallback(() => {
        const rawPath = customPath.trim() || machine?.metadata?.homeDir || '/home';
        const pathToUse = resolveAbsolutePath(rawPath, homeDir);
        const state = navigation.getState();
        const previousRoute = state?.routes?.[state.index - 1];
        if (state && state.index > 0 && previousRoute) {
            navigation.dispatch({
                ...CommonActions.setParams({ path: pathToUse }),
                source: previousRoute.key,
            } as never);
        }
        router.back();
    }, [customPath, router, machine, navigation, homeDir]);

    const renderRecommendedItems = React.useCallback(() => {
        if (recommendedPaths.length > 0) {
            return recommendedPaths.map((path, index) => (
                <Item
                    key={path}
                    title={path}
                    leftElement={renderPathIcon()}
                    onPress={() => {
                        if (path === customPath.trim()) {
                            handleSelectPath();
                            return;
                        }
                        setCustomPath(path);
                        inputRef.current?.focus();
                    }}
                    showChevron={false}
                    showDivider={index < recommendedPaths.length - 1}
                />
            ));
        }

        return (
            <Item
                title={t('wizard.noMatchingDirectories')}
                leftElement={
                    <View style={styles.pathIconSlot}>
                        <Ionicons
                            name="search-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </View>
                }
                disabled
                hideSelectedCheckmark
                showChevron={false}
                showDivider={false}
            />
        );
    }, [
        customPath,
        handleSelectPath,
        recommendedPaths,
        renderPathIcon,
        styles.pathIconSlot,
        theme.colors.textSecondary,
    ]);

    if (!machine) {
        return (
            <>
                <Stack.Screen
                    options={{
                        headerShown: true,
                        headerTitle: t('wizard.selectPath'),
                        headerRight: () => (
                            <Pressable
                                onPress={handleSelectPath}
                                disabled={!customPath.trim()}
                                style={({ pressed }) => ({
                                    width: 38,
                                    height: 38,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: pressed ? 0.7 : 1,
                                })}
                            >
                                <Ionicons
                                    name="checkmark"
                                    size={24}
                                    color={theme.colors.header.tint}
                                />
                            </Pressable>
                        )
                    }}
                />
                <View style={styles.container}>
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>
                            {t('wizard.noMachineSelected')}
                        </Text>
                    </View>
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: t('wizard.selectPath'),
                    headerRight: () => (
                        <Pressable
                            onPress={handleSelectPath}
                            disabled={!customPath.trim()}
                            style={({ pressed }) => ({
                                width: 38,
                                height: 38,
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: pressed ? 0.7 : 1,
                            })}
                        >
                            <Ionicons
                                name="checkmark"
                                size={24}
                                color={theme.colors.header.tint}
                            />
                        </Pressable>
                    )
                }}
            />
            <View style={styles.container}>
                <ScrollView
                    style={styles.scrollContainer}
                    contentInsetAdjustmentBehavior="automatic"
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    contentInset={keyboardInset}
                    scrollIndicatorInsets={keyboardInset}
                >
                    <View style={styles.contentWrapper}>
                        <ItemGroup title={t('wizard.enterPath')} headerStyle={styles.pathInputHeader} containerStyle={styles.pathInputGroup}>
                            <View style={styles.pathInput}>
                                <View style={styles.pathInputField}>
                                    <MultiTextInput
                                        ref={inputRef}
                                        value={customPath}
                                        onChangeText={setCustomPath}
                                        onFocus={() => setIsInputFocused(true)}
                                        placeholder={t('wizard.enterPathPlaceholder')}
                                        maxHeight={76}
                                        paddingTop={8}
                                        paddingBottom={8}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>
                                {isLoadingCompletions && (
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.colors.textSecondary}
                                        style={styles.pathInputSpinner}
                                    />
                                )}
                            </View>
                        </ItemGroup>

                        <ItemGroup title={recommendedTitle}>
                            {renderRecommendedItems()}
                        </ItemGroup>
                    </View>
                </ScrollView>
            </View>
        </>
    );
}
