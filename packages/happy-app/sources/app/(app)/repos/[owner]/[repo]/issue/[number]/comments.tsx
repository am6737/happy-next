import * as React from 'react';
import { View, Pressable, ActivityIndicator, Platform, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Stack } from '@/components/navigation/AppStack';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { MultiTextInput } from '@/components/MultiTextInput';
import * as ImagePicker from 'expo-image-picker';
import { useGithubIssueComments } from '@/hooks/useGithubData';
import { createGithubIssueComment, updateGithubIssueComment, deleteGithubIssueComment, uploadGithubImage } from '@/sync/apiGithubData';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatHeaderTitle } from '@/components/ChatHeaderTitle';
import { getNativeHeaderTitleWidth } from '@/utils/nativeHeaderTitleWidth';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { AgentContentView } from '@/components/AgentContentView';
import { ChatScrollView } from '@/components/ChatScrollView';
import { ScrollToBottomButton } from '@/components/ScrollToBottomButton';
import { distanceFromEnd } from '@/components/chatListRowModel';
import { useChatOverlayStyle } from '@/hooks/useChatOverlayStyle';
import { GlassSurface } from '@/components/GlassSurface';
import { COMPOSER_MARGIN, floatingComposerAvailable, floatingComposerBottomInset, floatingComposerScreenOptions } from '@/components/floatingComposer';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import type { RepoIssueComment } from '@/data/mockRepos';
import { useProfile } from '@/sync/storage';
import { t } from '@/text';
import { getGithubCommentFallbackRoute } from '@/utils/githubCommentNavigation';
import { CommentItem } from '@/components/repos/CommentItem';
import { isRunningOnMac } from '@/utils/platform';
import { softHeaderOptions, useSoftHeaderInset } from '@/components/navigation/softHeader';
import { KeyboardCenteredEmpty } from '@/components/KeyboardCenteredEmpty';
import { NativeMenu } from '@/components/NativeMenu';

// How far above the end the reader has to be for the scroll-to-bottom button to show.
const SCROLL_THRESHOLD = 100;
import { actionMenuSection, type ContextMenuSection } from '@/components/ContextMenuView';

export default React.memo(function IssueCommentsPage() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const softHeaderInset = useSoftHeaderInset();
    // Written by AgentContentView as the floating composer lays out, read by the list on the UI thread.
    const composerHeight = useSharedValue(0);
    const composerInset = floatingComposerAvailable ? composerHeight : undefined;
    const { owner, repo, number: numberStr, issueTitle, issueAuthor } = useLocalSearchParams<{ owner: string; repo: string; number: string; issueTitle?: string; issueAuthor?: string }>();
    const issueNumber = parseInt(numberStr, 10);
    const { credentials } = useAuth();
    const profile = useProfile();
    const githubLogin = profile.github?.login;
    const { data: comments, loading, loadingMore, hasMore, loadMore, mutate } = useGithubIssueComments(owner!, repo!, issueNumber);
    const [draft, setDraft] = React.useState('');

    // Editing state
    const [editingComment, setEditingComment] = React.useState<RepoIssueComment | null>(null);

    const startEditing = React.useCallback((comment: RepoIssueComment) => {
        setEditingComment(comment);
        setDraft(comment.body);
    }, []);

    const cancelEditing = React.useCallback(() => {
        setEditingComment(null);
        setDraft('');
    }, []);

    const submit = React.useCallback(async () => {
        const body = draft.trim();
        if (!body || !credentials) return;
        try {
            if (editingComment) {
                const updated = await updateGithubIssueComment(credentials, owner!, repo!, editingComment.id, body);
                mutate((prev) => prev.map((c) => c.id === editingComment.id ? updated : c));
                setEditingComment(null);
                setDraft('');
            } else {
                const created = await createGithubIssueComment(credentials, owner!, repo!, issueNumber, body);
                setDraft('');
                mutate((prev) => [...prev, created]);
            }
        } catch (e) {
            const code = (e as any)?.code;
            if (code === 'github_not_connected' || code === 'github_token_expired') {
                Modal.alert(t('issueComments.errorTitle'), t('issueComments.errorReconnect'));
            } else {
                const msg = editingComment ? t('issueComments.editFailed') : (e as any)?.message ?? t('issueComments.errorFallback');
                Modal.alert(t('issueComments.errorTitle'), msg);
            }
            throw e;
        }
    }, [draft, credentials, owner, repo, issueNumber, mutate, editingComment]);

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
                    router.replace(getGithubCommentFallbackRoute('issue', owner!, repo!, issueNumber) as any);
                }
            }}
            hitSlop={15}
        >
            <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={24} color={theme.colors.header.tint} />
        </Pressable>
    ), [router, owner, repo, issueNumber, theme.colors.header.tint]);


    // Comment action menu
    const [commentMenuVisible, setCommentMenuVisible] = React.useState(false);
    const [selectedComment, setSelectedComment] = React.useState<RepoIssueComment | null>(null);

    const handleCommentLongPress = React.useCallback((comment: RepoIssueComment) => {
        if (!githubLogin || comment.author !== githubLogin) return;
        setSelectedComment(comment);
        setCommentMenuVisible(true);
    }, [githubLogin]);

    const handleDeleteComment = React.useCallback(async (target?: RepoIssueComment) => {
        const commentToDelete = target ?? selectedComment;
        if (!commentToDelete || !credentials) return;
        const confirmed = await Modal.confirm(
            t('issueComments.deleteConfirmTitle'),
            t('issueComments.deleteConfirmMessage'),
            { destructive: true },
        );
        if (!confirmed) return;
        mutate((prev) => prev.filter((c) => c.id !== commentToDelete.id));
        try {
            await deleteGithubIssueComment(credentials, owner!, repo!, commentToDelete.id);
        } catch {
            mutate((prev) => [...prev, commentToDelete].sort((a, b) => a.id - b.id));
            Modal.alert(t('issueComments.errorTitle'), t('issueComments.deleteFailed'));
        }
    }, [selectedComment, credentials, owner, repo, mutate]);

    const commentMenuItems: ActionMenuItem[] = React.useMemo(() => [
        {
            label: t('issueComments.edit'),
            onPress: () => {
                if (selectedComment) startEditing(selectedComment);
            },
        },
        {
            label: t('issueComments.delete'),
            destructive: true,
            onPress: () => handleDeleteComment(),
        },
    ], [selectedComment, startEditing, handleDeleteComment]);

    // The same actions for the native context menu (iOS), which needs them per comment up front
    // rather than for the comment a long press picked. Only one's own comments have any.
    const commentMenuSections = React.useCallback((comment: RepoIssueComment): ContextMenuSection[] | undefined => {
        if (!githubLogin || comment.author !== githubLogin) return undefined;
        return [actionMenuSection([
            { label: t('issueComments.edit'), onPress: () => startEditing(comment) },
            { label: t('issueComments.delete'), destructive: true, onPress: () => handleDeleteComment(comment) },
        ])];
    }, [githubLogin, startEditing, handleDeleteComment]);

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
            console.error('[IssueComments] Image pick failed:', error);
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

    const renderScrollComponent = React.useCallback(
        (props: ScrollViewProps) => (
            <ChatScrollView
                {...props}
                bottomInset={composerInset ? floatingComposerBottomInset(insets.bottom) : insets.bottom}
                topInset={softHeaderInset}
                composerInset={composerInset}
                listRef={listRef}
            />
        ),
        [composerInset, insets.bottom, softHeaderInset, listRef],
    );

    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const handleScroll = React.useCallback((event: any) => {
        setShowScrollButton(distanceFromEnd(event.nativeEvent) > SCROLL_THRESHOLD);
    }, []);
    const handleScrollToBottom = React.useCallback(() => {
        void listRef.current?.scrollToEnd({ animated: false });
    }, []);
    // The list's frame does not shrink for the keyboard (or end at a floating composer), so the
    // scroll-to-bottom button is moved above both.
    const overlayStyle = useChatOverlayStyle(Platform.OS === 'ios', composerInset);

    const list = (
        <View style={styles.listWrapper}>
            <LegendList
                ref={listRef}
                data={comments}
                estimatedItemSize={120}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item, index }) => (
                    <CommentItem
                        comment={item}
                        issueAuthor={issueAuthor}
                        onLongPress={() => handleCommentLongPress(item)}
                        menuSections={commentMenuSections(item)}
                        isLast={index === comments.length - 1}
                    />
                )}
                // A new comment takes the last-row styling off the one before it.
                extraData={comments.length}
                onEndReached={hasMore ? loadMore : undefined}
                onEndReachedThreshold={0.5}
                maintainVisibleContentPosition
                maintainScrollAtEnd={{ on: { dataChange: true } }}
                initialScrollAtEnd
                ListHeaderComponent={useNativeSoftHeader ? <View style={{ height: softHeaderInset + 12 }} /> : null}
                estimatedHeaderSize={useNativeSoftHeader ? softHeaderInset + 12 : 0}
                ListEmptyComponent={<KeyboardCenteredEmpty composerInset={composerInset}>{listEmpty}</KeyboardCenteredEmpty>}
                ListFooterComponent={loadingMore ? (
                    <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
                ) : null}
                renderScrollComponent={renderScrollComponent}
                contentContainerStyle={[styles.list, comments.length === 0 && styles.listEmpty, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]}
                style={{ flex: 1, backgroundColor: theme.colors.surface }}
                keyboardShouldPersistTaps="handled"
                // An empty thread only shows its centered placeholder; the composer's inset would
                // otherwise leave it a little room to scroll. The keyboard still lifts it (scrollTo).
                scrollEnabled={comments.length > 0}
                onScroll={handleScroll}
                scrollEventThrottle={16}
            />
            <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, overlayStyle]}>
                {showScrollButton && (
                    <View pointerEvents="box-none" style={styles.scrollButton}>
                        <ScrollToBottomButton onPress={handleScrollToBottom} unreadCount={0} />
                    </View>
                )}
            </Animated.View>
        </View>
    );

    const composer = (
        <View style={[styles.composer, floatingComposerAvailable && styles.composerFloating, { paddingBottom: Platform.OS === 'ios' ? 0 : Math.max(insets.bottom, 12) }]}>
            {editingComment && (
                <GlassSurface glass={floatingComposerAvailable} style={[styles.editingBar, floatingComposerAvailable && styles.editingBarFloating]}>
                    <Ionicons name="pencil" size={14} color={theme.colors.textLink} />
                    <Text style={[styles.editingText, { color: theme.colors.textLink }]}>{t('issueComments.editing')}</Text>
                    <Pressable onPress={cancelEditing} hitSlop={8}>
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </GlassSurface>
            )}
            <View style={styles.inputRow}>
                <NativeMenu
                    items={menuItems}
                    disabled={uploading || !!editingComment}
                    style={styles.addButton}
                    onFallbackOpen={() => setMenuVisible(true)}
                >
                    <GlassSurface glass={floatingComposerAvailable} color={theme.colors.surfaceHighest} style={styles.addCircle}>
                        {uploading ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <Ionicons name="add" size={24} color={editingComment ? theme.colors.divider : theme.colors.textSecondary} />
                        )}
                    </GlassSurface>
                </NativeMenu>
                <GlassSurface glass={floatingComposerAvailable} color={theme.colors.surfaceHighest} style={styles.inputGroup}>
                    <MultiTextInput
                        style={{ flex: 1, paddingVertical: 6 }}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={uploading ? t('issueComments.uploadingImage') : editingComment ? t('issueComments.editing') : t('issueComments.placeholder')}
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
                                    name={editingComment ? 'checkmark' : 'arrow-up'}
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
            <ActionMenuModal
                visible={commentMenuVisible}
                items={commentMenuItems}
                onClose={() => setCommentMenuVisible(false)}
            />
        </SafeAreaView>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    listWrapper: {
        flex: 1,
    },
    scrollButton: {
        position: 'absolute',
        bottom: 16,
        right: 16,
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
    editingBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    editingBarFloating: {
        borderRadius: 16,
        marginTop: 4,
    },
    editingText: {
        flex: 1,
        fontSize: 13,
        ...Typography.default('semiBold'),
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
