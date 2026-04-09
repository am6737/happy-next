import * as React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';

interface BranchSelectSheetProps {
    branches: string[];
    selectedBranch: string;
    onSelect: (branch: string) => void;
}

export const BranchSelectSheet = React.memo(
    React.forwardRef<BottomSheetModal, BranchSelectSheetProps>(
        ({ branches, selectedBranch, onSelect }, ref) => {
            const { theme } = useUnistyles();
            const [search, setSearch] = React.useState('');

            const filteredBranches = React.useMemo(() => {
                if (!search.trim()) return branches;
                const q = search.toLowerCase();
                return branches.filter((b) => b.toLowerCase().includes(q));
            }, [branches, search]);

            const renderBackdrop = (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    opacity={0.4}
                    appearsOnIndex={0}
                    disappearsOnIndex={-1}
                />
            );

            const renderItem = ({ item }: { item: string }) => {
                const isSelected = item === selectedBranch;
                return (
                    <Pressable
                        style={[
                            styles.branchItem,
                            { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
                        ]}
                        onPress={() => {
                            onSelect(item);
                            (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
                        }}
                    >
                        <View style={styles.branchItemLeft}>
                            <Ionicons
                                name="git-branch"
                                size={16}
                                color={isSelected ? '#007AFF' : theme.colors.textSecondary}
                            />
                        </View>
                        <Text
                            style={[
                                styles.branchName,
                                { color: isSelected ? '#007AFF' : theme.colors.text },
                            ]}
                            numberOfLines={1}
                        >
                            {item}
                        </Text>
                        {isSelected && (
                            <Ionicons name="checkmark" size={18} color="#007AFF" />
                        )}
                    </Pressable>
                );
            };

            return (
                <BottomSheetModal
                    ref={ref}
                    snapPoints={['55%']}
                    enableDynamicSizing={false}
                    keyboardBehavior="interactive"
                    keyboardBlurBehavior="restore"
                    backdropComponent={renderBackdrop}
                    backgroundStyle={{ backgroundColor: theme.colors.groupped.background }}
                    handleIndicatorStyle={{ backgroundColor: theme.colors.divider }}
                >
                    <View style={styles.container}>
                        {/* Header */}
                        <View style={[styles.header, { borderColor: theme.colors.divider }]}>
                            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                                Select Branch
                            </Text>
                        </View>

                        {/* Search */}
                        <View style={[styles.searchContainer, { borderColor: theme.colors.divider }]}>
                            <Ionicons name="search" size={15} color={theme.colors.textSecondary} />
                            <TextInput
                                style={[styles.searchInput, { color: theme.colors.text }]}
                                placeholder="Search branches..."
                                placeholderTextColor={theme.colors.textSecondary}
                                value={search}
                                onChangeText={setSearch}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            {search.length > 0 && (
                                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                                    <Ionicons name="close-circle" size={15} color={theme.colors.textSecondary} />
                                </Pressable>
                            )}
                        </View>

                        {/* Branch List */}
                        <BottomSheetFlatList
                            data={filteredBranches}
                            keyExtractor={(item: string) => item}
                            renderItem={renderItem}
                            contentContainerStyle={styles.listContent}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            ListEmptyComponent={
                                <View style={styles.empty}>
                                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                        No branches match "{search}"
                                    </Text>
                                </View>
                            }
                        />
                    </View>
                </BottomSheetModal>
            );
        }
    )
);

// ---- Styles ----

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginVertical: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        padding: 0,
    },
    listContent: {
        paddingVertical: 8,
    },
    branchItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 0,
    },
    branchItemLeft: {
        width: 24,
        alignItems: 'center',
    },
    branchName: {
        flex: 1,
        fontSize: 15,
    },
    empty: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
    },
});
