import { useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, KeyboardAvoidingView, Platform, FlatList } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { UserSearchResult } from '@/components/UserSearchResult';
import { searchUsersByUsername, sendFriendRequest } from '@/sync/apiFriends';
import { useAuth } from '@/auth/AuthContext';
import { UserProfile } from '@/sync/friendTypes';
import { Modal } from '@/modal';
import { t } from '@/text';
import { trackFriendsConnect } from '@/track';
import { showToast } from '@/components/Toast';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { useSearch } from '@/hooks/useSearch';
import { useProfile } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { isRunningOnMac } from '@/utils/platform';
import { SearchField } from '@/components/SearchField';
import { layout } from '@/components/layout';

export default function SearchFriendsScreen() {
    const { credentials } = useAuth();
    const profile = useProfile();
    const hasGithub = !!profile.github;
    const [searchQuery, setSearchQuery] = useState('');
    const [processingUserId, setProcessingUserId] = useState<string | null>(null);
    const useNativeKeyboardInsets = Platform.OS === 'ios' && !isRunningOnMac();
    
    // Use the new search hook
    const { results: searchResults, isSearching } = useSearch(
        searchQuery,
        useCallback((query: string) => {
            if (!credentials) {
                return Promise.resolve([]);
            }
            return searchUsersByUsername(credentials, query.trim());
        }, [credentials])
    );
    
    const handleAddFriend = useCallback(async (user: UserProfile) => {
        if (!credentials) return;

        setProcessingUserId(user.id);
        try {
            const updatedProfile = await sendFriendRequest(credentials, user.id);

            if (updatedProfile) {
                trackFriendsConnect();
                sync.refreshFriends();
                showToast(t('friends.requestSent'));
            } else {
                await Modal.alert(t('friends.bothMustHaveGithub'));
            }
        } catch (error: any) {
            console.error('Failed to send friend request:', error);
            if (error.message?.includes('yourself')) {
                await Modal.alert(t('friends.cannotAddYourself'));
            } else {
                await Modal.alert(t('errors.failedToSendRequest'));
            }
        } finally {
            setProcessingUserId(null);
        }
    }, [credentials]);

    const renderUserItem = ({ item }: { item: UserProfile }) => (
        <UserSearchResult
            user={item}
            onAddFriend={() => handleAddFriend(item)}
            isProcessing={processingUserId === item.id}
        />
    );

    const renderSeparator = () => (
        <View style={styles.separator} />
    );
    
    const hasSearched = searchQuery.trim().length > 0;

    return (
        <KeyboardAvoidingView
            enabled={!useNativeKeyboardInsets}
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ItemList
                style={{ paddingTop: 0 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets={useNativeKeyboardInsets}
            >
                {!hasGithub ? (
                    <ItemGroup style={styles.resultsGroup}>
                        <View style={styles.helpContainer}>
                            <Text style={styles.helpTitle}>
                                {t('settings.connectGithubAccount')}
                            </Text>
                            <Text style={styles.helpText}>
                                {t('friends.connectGithubToSearch')}
                            </Text>
                        </View>
                    </ItemGroup>
                ) : (
                    <>
                        <View style={styles.searchSection}>
                            <SearchField
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholder={t('friends.searchPlaceholder')}
                                editable={!processingUserId}
                                loading={isSearching}
                            />
                        </View>

                        <ItemGroup
                            style={styles.resultsGroup}
                        >
                            <View style={styles.resultsSection}>
                                {isSearching && searchResults.length === 0 ? (
                                    <View style={styles.loadingContainer}>
                                        <ActivityIndicator size="large" color="#2BACCC" />
                                        <Text style={styles.loadingText}>{t('friends.searching')}</Text>
                                    </View>
                                ) : searchResults.length > 0 ? (
                                    <FlatList
                                        data={searchResults}
                                        renderItem={renderUserItem}
                                        ItemSeparatorComponent={renderSeparator}
                                        keyExtractor={(item) => item.id}
                                        scrollEnabled={false}
                                        contentContainerStyle={styles.resultsList}
                                    />
                                ) : hasSearched ? (
                                    <View style={styles.noResultsContainer}>
                                        <Text style={styles.noResultsText}>
                                            {t('friends.noUserFound')}
                                        </Text>
                                        <Text style={styles.noResultsHint}>
                                            {t('friends.checkUsername')}
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.helpContainer}>
                                        <Text style={styles.helpTitle}>
                                            {t('friends.howToFind')}
                                        </Text>
                                        <Text style={styles.helpText}>
                                            {t('friends.findInstructions')}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </ItemGroup>
                    </>
                )}
            </ItemList>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    // The field heads the page, as on the other searchable pages, its instructions under it as a
    // group's footer would be.
    searchSection: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingTop: Platform.select({ ios: 12, default: 16 }),
        paddingHorizontal: 16,
    },
    resultsGroup: {
        marginBottom: 16,
    },
    resultsSection: {
        minHeight: 200,
    },
    resultsList: {
        paddingVertical: 4,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 80,
        marginRight: 16,
    },
    loadingContainer: {
        alignItems: 'center',
        padding: 32,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    noResultsContainer: {
        alignItems: 'center',
        padding: 32,
    },
    noResultsText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        marginBottom: 8,
    },
    noResultsHint: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    helpContainer: {
        padding: 32,
        alignItems: 'center',
    },
    helpTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
        marginBottom: 16,
    },
    helpText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
    },
}));