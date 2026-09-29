import * as React from 'react';
import { View, Pressable, ActivityIndicator, Platform, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { MultiTextInput } from '@/components/MultiTextInput';
import * as ImagePicker from 'expo-image-picker';
import { useGithubIssueComments } from '@/hooks/useGithubData';
import { createGithubIssueComment, uploadGithubImage } from '@/sync/apiGithubData';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatHeaderTitle } from '@/components/ChatHeaderTitle';
import { getNativeHeaderTitleWidth } from '@/utils/nativeHeaderTitleWidth';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';
import { AgentContentView } from '@/components/AgentContentView';
import { ChatScrollView, useChatListSettled } from '@/components/ChatScrollView';
import { GlassSurface } from '@/components/GlassSurface';
import { COMPOSER_MARGIN, floatingComposerAvailable, floatingComposerBottomInset, floatingComposerScreenOptions } from '@/components/floatingComposer';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { t } from '@/text';
import { getGithubCommentFallbackRoute } from '@/utils/githubCommentNavigation';
import { CommentItem } from '@/components/repos/CommentItem';
import { isRunningOnMac } from '@/utils/platform';
import { softHeaderOptions, useSoftHeaderInset } from '@/components/navigation/softHeader';
import { KeyboardCenteredEmpty } from '@/components/KeyboardCenteredEmpty';
import { NativeMenu } from '@/components/NativeMenu';

export default React.memo(function PRCommentsPage() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const softHeaderInset = useSoftHeaderInset();
    // Written by AgentContentView as the floating composer lays out, read by the list on the UI thread.
    const composerHeight = useSharedValue(0);
    const composerInset = floatingComposerAvailable ? composerHeight : undefined;
    const { owner, repo, number: numberStr, issueTitle, issueAuthor } = useLocalSearchParams<{ owner: string; repo: string; number: string; issueTitle?: string; issueAuthor?: string }>();
    const prNumber = parseInt(numberStr, 10);
    const { credentials } = useAuth();
    const { data: comments, loading, loadingMore, hasMore, loadMore, mutate } = useGithubIssueComments(owner!, repo!, prNumber);
    const [draft, setDraft] = React.useState('');

    const submit = React.useCallback(async () => {
        const body = draft.trim();
        if (!body || !credentials) return;
        try {
            const created = await createGithubIssueComment(credentials, owner!, repo!, prNumber, body);
            setDraft('');
            mutate((prev) => [...prev, created]);
        } catch (e) {
            const code = (e as any)?.code;
            if (code === 'github_not_connected' || code === 'github_token_expired') {
                Modal.alert(t('issueComments.errorTitle'), t('issueComments.errorReconnect'));
            } else {
                Modal.alert(t('issueComments.errorTitle'), (e as any)?.message ?? t('issueComments.errorFallback'));
            }
            throw e;
        }
    }, [draft, credentials, owner, repo, prNumber, mutate]);

    const [submitting, doSubmit] = useHappyAction(submit);
    const canSubmit = draft.trim().length > 0 && !submitting;

    const [menuVisible, setMenuVisible] = React.useState(false);
    const [uploading, setUploading] = React.useState(false);

    const headerLeft = React.useCallback(() => (
        <Pressable
            onPress={() => {
                if (router.canGoBack()) {
                    router.back();
                } else {
                    router.replace(getGithubCommentFallbackRoute('pull', owner!, repo!, prNumber) as any);
                }
            }}
            hitSlop={15}
        >
            <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={24} color={theme.colors.header.tint} />
        </Pressable>
    ), [router, owner, repo, prNumber, theme.colors.header.tint]);


    const handlePickImage = React.useCallback(async (source: 'camera' | 'gallery') => {
        if (!credentials) return;
        try {
            const picker = source === 'camera'
                ? ImagePicker.launchCameraAsync
                : ImagePicker.launchImageLibraryAsync;

            if (source === 'camera') {
                const perm = await ImagePicker.requestCameraPermissionsAsync();
                if (!perm.granted) return;
            } else {
                const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!perm.granted) return;
            }

            const result = await picker({ mediaTypes: ['images'], quality: 0.8 });
            if (result.canceled || !result.assets[0]) return;

            const asset = result.assets[0];
            const mimeType = asset.mimeType || 'image/jpeg';

            setUploading(true);
            try {
                const uploaded = await uploadGithubImage(credentials, owner, repo, asset.uri, mimeType);
                const filename = asset.fileName || 'image';
                setDraft((prev) => {
                    const md = `![${filename}](${uploaded.url})`;
                    return prev ? `${prev}\n${md}` : md;
                });
            } catch (e) {
                Modal.alert(t('issueComments.errorTitle'), t('issueComments.uploadFailed'));
            } finally {
                setUploading(false);
            }
        } catch (error) {
            console.error('[PRComments] Image pick failed:', error);
        }
    }, [credentials]);

    const menuItems: ActionMenuItem[] = React.useMemo(() => [
        { label: t('issueComments.takePhoto'), onPress: () => handlePickImage('camera') },
        { label: t('issueComments.chooseFromAlbum'), onPress: () => handlePickImage('gallery') },
    ], [handlePickImage]);

    const { width: screenWidth } = useWindowDimensions();
    const headerTitleText = comments.length > 0 ? `${t('issueComments.title')}（${comments.length}）` : t('issueComments.title');
    const headerSubtitleText = issueTitle ? decodeURIComponent(issueTitle as string) : undefined;
    const headerTitleWidth = getNativeHeaderTitleWidth({ screenWidth, rightActionCount: 0 });
    const headerTitle = React.useCallback(() => (
        <ChatHeaderTitle title={headerTitleText} subtitle={headerSubtitleText} width={headerTitleWidth} />
    ), [headerTitleText, headerSubtitleText, headerTitleWidth]);
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();

    const listEmpty = React.useMemo(() => (
        <View style={styles.emptyContainer}>
            {loading ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : (
                <Text style={styles.emptyText}>{t('issueComments.empty')}</Text>
            )}
        </View>
    ), [loading, theme]);

    const listRef = React.useRef<LegendListRef>(null);
    const { listSettled, onReady: handleListReady } = useChatListSettled();

    const renderScrollComponent = React.useCallback(
        (props: ScrollViewProps) => (
            <ChatScrollView
                {...props}
                bottomInset={composerInset ? floatingComposerBottomInset(insets.bottom) : insets.bottom}
                topInset={softHeaderInset}
                composerInset={composerInset}
                listRef={listRef}
                listSettled={listSettled}
            />
        ),
        [composerInset, insets.bottom, softHeaderInset, listRef, listSettled],
    );

    const list = (
        <LegendList
            ref={listRef}
            data={comments}
            estimatedItemSize={120}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item, index }) => (
                <CommentItem comment={item} issueAuthor={issueAuthor} isLast={index === comments.length - 1} />
            )}
            // A new comment takes the last-row styling off the one before it.
            extraData={comments.length}
            onEndReached={hasMore ? loadMore : undefined}
            onEndReachedThreshold={0.5}
            maintainVisibleContentPosition
            maintainScrollAtEnd={{ on: { dataChange: true } }}
            initialScrollAtEnd
            alignItemsAtEnd
            ListHeaderComponent={useNativeSoftHeader ? <View style={{ height: softHeaderInset + 12 }} /> : null}
            estimatedHeaderSize={useNativeSoftHeader ? softHeaderInset + 12 : 0}
            ListEmptyComponent={<KeyboardCenteredEmpty composerInset={composerInset}>{listEmpty}</KeyboardCenteredEmpty>}
            ListFooterComponent={loadingMore ? (
                <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
            ) : null}
            renderScrollComponent={renderScrollComponent}
            onReady={handleListReady}
            contentContainerStyle={[styles.list, comments.length === 0 && styles.listEmpty, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            keyboardShouldPersistTaps="handled"
            // An empty thread only shows its centered placeholder; the composer's inset would
            // otherwise leave it a little room to scroll. The keyboard still lifts it (scrollTo).
            scrollEnabled={comments.length > 0}
        />
    );

    const composer = (
        <View style={[styles.composer, floatingComposerAvailable && styles.composerFloating, { paddingBottom: Platform.OS === 'ios' ? 0 : Math.max(insets.bottom, 12) }]}>
            <View style={styles.inputRow}>
                <NativeMenu
                    items={menuItems}
                    disabled={uploading}
                    style={styles.addButton}
                    onFallbackOpen={() => setMenuVisible(true)}
                >
                    <GlassSurface glass={floatingComposerAvailable} color={theme.colors.surfaceHighest} style={styles.addCircle}>
                        {uploading ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <Ionicons name="add" size={24} color={theme.colors.textSecondary} />
                        )}
                    </GlassSurface>
                </NativeMenu>
                <GlassSurface glass={floatingComposerAvailable} color={theme.colors.surfaceHighest} style={styles.inputGroup}>
                    <MultiTextInput
                        style={{ flex: 1, paddingVertical: 6 }}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={uploading ? t('issueComments.uploadingImage') : t('issueComments.placeholder')}
                        maxHeight={120}
                        paddingTop={6}
                        paddingBottom={6}
                        lineHeight={20}
                    />
                    <Pressable
                        onPress={doSubmit}
                        disabled={!canSubmit}
                        hitSlop={4}
                        style={styles.sendButton}
                    >
                        {submitting ? (
                            <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                        ) : (
                            <View style={[
                                styles.sendCircle,
                                {
                                    backgroundColor: canSubmit
                                        ? theme.colors.button.primary.background
                                        : theme.colors.button.primary.disabled,
                                },
                            ]}>
                                <Ionicons
                                    name="arrow-up"
                                    size={20}
                                    color={theme.colors.button.primary.tint}
                                />
                            </View>
                        )}
                    </Pressable>
                </GlassSurface>
            </View>
        </View>
    );

    return (
        <SafeAreaView edges={floatingComposerAvailable ? [] : ['bottom']} style={styles.container}>
            <Stack.Screen options={{ ...softHeaderOptions, ...floatingComposerScreenOptions, headerTitle: useNativeSoftHeader ? headerTitleText : headerTitle, headerSubtitle: useNativeSoftHeader ? headerSubtitleText : undefined, headerSubtitleColor: useNativeSoftHeader ? theme.colors.textSecondary : undefined, headerLeft }} />
            {floatingComposerAvailable ? (
                <AgentContentView floatingInput composerHeight={composerHeight} content={list} input={composer} />
            ) : (
                <>
                    {list}
                    <KeyboardStickyView
                        offset={{ opened: Platform.OS === 'ios' ? insets.bottom - COMPOSER_MARGIN : insets.bottom }}
                    >
                        {composer}
                    </KeyboardStickyView>
                </>
            )}
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
                deferItemPress
            />
        </SafeAreaView>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    // Only an empty thread stretches to the viewport, for its centered placeholder: stretched, a
    // short thread would outgrow the room left above the composer and scroll.
    listEmpty: {
        flexGrow: 1,
    },
    list: {
        paddingTop: 16,
        paddingHorizontal: 16,
        paddingBottom: COMPOSER_MARGIN,
        gap: 0,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    composer: {
        paddingHorizontal: 10,
        paddingTop: theme.margins.xs,
        backgroundColor: theme.colors.header.background,
    },
    // Floating over the chat as glass pieces (see `floatingComposerAvailable`) rather than on a bar.
    composerFloating: {
        backgroundColor: 'transparent',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingVertical: theme.margins.sm,
        gap: theme.margins.sm,
    },
    addButton: {
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 1,
    },
    addCircle: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputGroup: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderRadius: 22,
        paddingLeft: 16,
        paddingRight: 4,
        minHeight: 44,
    },
    sendButton: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginBottom: 5,
    },
    sendCircle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
