import * as React from 'react';
import { View, ScrollView, Pressable, RefreshControl, TextInput } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import { isMachineOnline } from '@/utils/machineUtils';
import type { Machine } from '@/sync/storageTypes';

// Machine display type derived from real Machine type
interface DisplayMachine {
    id: string;
    name: string;
    host: string;
    status: 'online' | 'offline';
    type: 'cloud' | 'local';
    registeredVia: string;
    creatingProgress: number;
    lastSeen: string;
}


const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 16,
        paddingBottom: 32,
        gap: 12,
    },
    item: {
        backgroundColor: theme.colors.surface,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        padding: 14,
    },
    itemMain: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    machineIconBox: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    itemContent: {
        flex: 1,
    },
    machineNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    machineName: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    machineHost: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        marginTop: 6,
        alignSelf: 'flex-start',
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600',
    },
    typeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    typeText: {
        fontSize: 11,
        fontWeight: '500',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
    },
    metaText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    progressContainer: {
        marginTop: 8,
        gap: 4,
    },
    progressBarBg: {
        height: 3,
        backgroundColor: theme.colors.divider,
        borderRadius: 1.5,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#007AFF',
    },
    progressText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginLeft: 66,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: 60,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
        marginTop: 12,
    },
    emptySubtitle: {
        marginTop: 8,
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
}));

function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return `${Math.floor(diffD / 30)}mo ago`;
}

function getCreatingStepLabel(progress: number): string {
    if (progress < 33) return 'Connecting to machine…';
    if (progress < 66) return 'Installing Happy Agent…';
    return 'Verifying connection…';
}

export default function MachinesScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();

    // Get machines from storage
    const allMachines = storage(useShallow((state) => state.machines)) as Record<string, Machine>;

    // Transform machines to display format
    const machines: DisplayMachine[] = React.useMemo(() => {
        return Object.values(allMachines).map((m): DisplayMachine => ({
            id: m.id,
            name: m.metadata?.displayName || m.metadata?.host || m.id.slice(0, 8),
            host: m.metadata?.host || 'Unknown host',
            status: isMachineOnline(m) ? 'online' : 'offline',
            type: m.metadata?.platform === 'android' || m.metadata?.platform === 'ios' ? 'local' : 'cloud',
            registeredVia: 'Direct',
            creatingProgress: 0,
            lastSeen: new Date(m.activeAt).toISOString(),
        }));
    }, [allMachines]);

    const [refreshing, setRefreshing] = React.useState(false);
    const [searchVisible, setSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const searchInputRef = React.useRef<TextInput>(null);

    // Filter machines by search query
    const filteredMachines = React.useMemo(() => {
        if (!searchQuery.trim()) return machines;
        const q = searchQuery.toLowerCase();
        return machines.filter((m) =>
            m.name.toLowerCase().includes(q) ||
            m.host.toLowerCase().includes(q)
        );
    }, [machines, searchQuery]);

    // Set header title (search input or text) and right buttons
    React.useEffect(() => {
        navigation.setOptions({
            headerTitle: () => searchVisible ? (
                <TextInput
                    ref={searchInputRef}
                    style={{
                        flex: 1,
                        fontSize: 17,
                        color: theme.colors.text,
                        paddingVertical: 0,
                    }}
                    placeholder="Search machines..."
                    placeholderTextColor={theme.colors.textSecondary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoFocus
                    selectionColor="#007AFF"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onBlur={() => {
                        setSearchVisible(false);
                        setSearchQuery('');
                    }}
                />
            ) : (
                <Text style={{ fontSize: 17, fontWeight: '600', color: theme.colors.header.tint }}>{t('lab.machinesTab')}</Text>
            ),
            headerRight: searchVisible ? undefined : () => (
                <View style={{ flexDirection: 'row', gap: 12, paddingRight: 16, alignItems: 'center' }}>
                    <Pressable onPress={() => setSearchVisible(true)} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="search-outline" size={22} color={theme.colors.header.tint} />
                    </Pressable>
                    <Pressable onPress={() => router.push('/repos/machines/add')} hitSlop={15} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, theme, router, searchVisible, searchQuery]);

    const handleRefresh = React.useCallback(() => {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 800);
    }, []);

    const renderMachineItem = React.useCallback((item: DisplayMachine, index: number, arr: DisplayMachine[]) => {
        const statusColor = item.status === 'online' ? '#34C759' : '#8E8E93';
        const typeColor = item.type === 'cloud' ? '#007AFF' : '#AF52DE';
        const statusLabel = item.status === 'online' ? 'Online' : 'Offline';
        const typeLabel = item.type === 'cloud' ? 'Cloud' : 'Local';

        return (
            <React.Fragment key={item.id}>
                <Pressable
                    style={styles.item}
                    onPress={() => router.push(`/repos/machine/${item.id}`)}
                >
                    <View style={styles.itemMain}>
                        <View style={[styles.machineIconBox, { backgroundColor: `${typeColor}20` }]}>
                            <Ionicons
                                name={item.type === 'cloud' ? 'cloud-outline' : 'desktop-outline'}
                                size={20}
                                color={typeColor}
                            />
                        </View>

                        <View style={styles.itemContent}>
                            <View style={styles.machineNameRow}>
                                <Text style={styles.machineName}>{item.name}</Text>
                                {item.status === 'online' && (
                                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' }} />
                                )}
                            </View>
                            <Text style={styles.machineHost}>{item.host}</Text>

                            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
                                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                                <Text style={[styles.statusText, { color: statusColor }]}>
                                    {statusLabel}
                                </Text>
                            </View>

                            <View style={styles.metaRow}>
                                <View style={[styles.typeBadge]}>
                                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: typeColor }} />
                                    <Text style={[styles.typeText, { color: typeColor }]}>{typeLabel}</Text>
                                </View>
                                <Text style={styles.metaText}>via {item.registeredVia}</Text>
                                <Text style={styles.metaText}>· {formatTimeAgo(item.lastSeen)}</Text>
                            </View>
                        </View>
                    </View>
                </Pressable>
                {index < arr.length - 1 && <View style={styles.divider} />}
            </React.Fragment>
        );
    }, [router, styles, theme]);

    const listEmpty = React.useMemo(() => (
        <View style={styles.emptyContainer}>
            <Ionicons name="hardware-chip-outline" size={48} color={theme.colors.textSecondary} />
            <Text style={styles.emptyTitle}>No machines</Text>
            <Text style={styles.emptySubtitle}>
                Add a machine using QR code, Docker, or manual URL
            </Text>
        </View>
    ), [styles, theme]);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ title: t('lab.machinesTab') }} />

            <Pressable
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}
                onPress={() => {
                    searchInputRef.current?.blur();
                    setSearchVisible(false);
                    setSearchQuery('');
                }}
            />

            <ScrollView
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={theme.colors.textSecondary}
                    />
                }
                contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}
            >
                {filteredMachines.length === 0 ? (
                    listEmpty
                ) : (
                    <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
                        {filteredMachines.map((machine, index) => renderMachineItem(machine, index, filteredMachines))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}
