import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isRunningOnMac } from '@/utils/platform';
import { GlassSurface, liquidGlassAvailable } from '@/components/GlassSurface';
import { CommandPaletteResults } from '@/components/CommandPalette/CommandPaletteResults';
import { CommandPaletteHistory } from '@/components/CommandPalette/CommandPaletteHistory';
import { useCommandPalette } from '@/components/CommandPalette/useCommandPalette';
import { useCommandPaletteData } from '@/components/CommandPalette/useCommandPaletteData';
import { useCommittedText } from '@/hooks/useCommittedText';

const noop = () => {};

// iOS searches in the system header, which moves along with the other pages' headers when one opens
// or closes. Elsewhere the app draws the headers, each moving with its page, so the page draws a bar
// of its own
const nativeSearchBar = Platform.OS === 'ios' && !isRunningOnMac();

const BAR_HEIGHT = Platform.select({ ios: 48, default: 44 });
const BAR_PADDING_TOP = 6;
const BAR_PADDING_BOTTOM = 10;

// The header field's height, as the system's glass buttons beside it, or the system's search field
// before Liquid Glass
const HEADER_FIELD_HEIGHT = liquidGlassAvailable ? 44 : 36;
// What the header field leaves of the width: the header's two margins, the close button and the gap
// before it
const HEADER_FIELD_INSET = 16 + 16 + 44 + 18;
// The clear button has room of its own around it, so the field's trailing padding is small
const HEADER_FIELD_PADDING_RIGHT = liquidGlassAvailable ? 8 : 4;
// The width UIKit gives the text field's clear button at its trailing end, the spinner centred on it
const CLEAR_BUTTON_WIDTH = 28;

// The phone's search: what the command palette searches, as a page of its own. A result opens over
// it, so going back returns to the search as it was left. With nothing typed the recent searches
// lead the page.
export default React.memo(function SearchScreen() {
    const { width } = useWindowDimensions();
    const tileColumns = width >= 600 ? 4 : 2;
    const { commands, searchMessages } = useCommandPaletteData(true);
    const palette = useCommandPalette(commands, noop, searchMessages, tileColumns);
    return nativeSearchBar
        ? <NativeSearchPage palette={palette} tileColumns={tileColumns} />
        : <BarSearchPage palette={palette} tileColumns={tileColumns} />;
});

type SearchPageProps = {
    palette: ReturnType<typeof useCommandPalette>;
    tileColumns: number;
};

// The recent searches with nothing typed, then the results
function SearchContent({ palette, tileColumns, onSelectHistoryEntry }: SearchPageProps & { onSelectHistoryEntry: (entry: string) => void }) {
    return (
        <>
            {!palette.searchQuery && palette.searchHistory.length > 0 && (
                <CommandPaletteHistory
                    page
                    history={palette.searchHistory}
                    // No keyboard selection on a touch screen
                    selectedIndex={-1}
                    onSelect={onSelectHistoryEntry}
                    anchorRef={palette.historyAnchorRef}
                    onRemove={palette.removeHistoryEntry}
                    onClear={palette.clearHistory}
                />
            )}
            <CommandPaletteResults
                page
                categories={palette.filteredCategories}
                selectedIndex={-1}
                onSelectCommand={palette.handleSelectCommand}
                anchorRef={palette.resultsAnchorRef}
                executingCommandId={palette.executingCommandId}
                searchQuery={palette.searchQuery}
                tileColumns={tileColumns}
            />
        </>
    );
}

// iOS: the field is the system header's title, and the header's own button closes the page. The
// field keeps its text itself, as its header only updates after the page renders, and the page only
// sends it a text to show, for a recent search picked
function NativeSearchPage({ palette, tileColumns }: SearchPageProps) {
    const styles = stylesheet;
    const navigation = useNavigation();
    const { inputRef, isSearchingMessages, handleSearchChange, selectHistoryEntry } = palette;
    const [shownText, setShownText] = React.useState<{ text: string } | null>(null);

    // Focused once the page is open: the keyboard rising while the page slides in would move the
    // two at once. Only the first time — coming back from a result finds the search as it was left
    React.useEffect(() => {
        const unsubscribe = navigation.addListener('transitionEnd' as any, (e: any) => {
            if (e.data?.closing) return;
            unsubscribe();
            inputRef.current?.focus();
        });
        return unsubscribe;
    }, [navigation, inputRef]);

    const onSearchRef = React.useRef(handleSearchChange);
    onSearchRef.current = handleSearchChange;
    const headerTitle = React.useCallback(() => (
        <SearchHeaderField
            inputRef={inputRef}
            onSearch={(text) => onSearchRef.current(text)}
            shownText={shownText}
            searching={isSearchingMessages}
        />
    ), [inputRef, shownText, isSearchingMessages]);

    const selectHistory = React.useCallback((entry: string) => {
        setShownText({ text: entry });
        selectHistoryEntry(entry);
    }, [selectHistoryEntry]);

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.nativeContent}
            // UIKit insets the content below the header and above the home indicator
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
        >
            <Stack.Screen options={{ headerTitle }} />
            <SearchContent palette={palette} tileColumns={tileColumns} onSelectHistoryEntry={selectHistory} />
        </ScrollView>
    );
}

// The header's search field, from the leading margin to the close button. UIKit centres a title, so
// it is as wide as that space and no wider
function SearchHeaderField({ inputRef, onSearch, shownText, searching }: {
    inputRef: React.RefObject<TextInput | null>;
    onSearch: (text: string) => void;
    shownText: { text: string } | null;
    searching: boolean;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const safeArea = useSafeAreaInsets();
    const { showText, ...field } = useCommittedText(onSearch);

    React.useEffect(() => {
        if (shownText) showText(shownText.text);
    }, [shownText, showText]);

    return (
        <GlassSurface
            glass={liquidGlassAvailable}
            color={theme.colors.surfaceHigh}
            style={[styles.headerField, { width: width - safeArea.left - safeArea.right - HEADER_FIELD_INSET }]}
        >
            <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
            <TextInput
                ref={inputRef}
                style={[styles.input, Typography.default(), searching && styles.inputSearching]}
                value={field.value}
                onChange={field.onChange}
                onSubmitEditing={field.onSubmitEditing}
                onEndEditing={field.onEndEditing}
                placeholder={t('sessionScope.search')}
                placeholderTextColor={theme.colors.textSecondary}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode={searching ? 'never' : 'while-editing'}
            />
            {/* The message search runs on after the other results show, where the clear button is */}
            {searching && (
                <View style={styles.headerSpinner} pointerEvents="none">
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            )}
        </GlassSurface>
    );
}

// Android and the Mac: in place of a header the page has a bar of its own, as Telegram's search
// does — the field and a button closing the page, floating over the results. It sits below the
// safe area, known from the first frame, so it doesn't move while the page opens
function BarSearchPage({ palette, tileColumns }: SearchPageProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const { inputRef, handleSearchChange, isSearchingMessages, selectHistoryEntry } = palette;
    const field = useCommittedText(handleSearchChange);
    const { showText } = field;

    const selectHistory = React.useCallback((entry: string) => {
        showText(entry);
        selectHistoryEntry(entry);
    }, [showText, selectHistoryEntry]);

    const barBottom = safeArea.top + BAR_PADDING_TOP + BAR_HEIGHT + BAR_PADDING_BOTTOM;

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={{ paddingTop: barBottom, paddingBottom: safeArea.bottom + 16 }}
                scrollIndicatorInsets={{ top: barBottom - safeArea.top }}
                contentInsetAdjustmentBehavior="never"
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                <SearchContent palette={palette} tileColumns={tileColumns} onSelectHistoryEntry={selectHistory} />
            </ScrollView>

            {/* The results fade out under the status bar and the bar floating over them */}
            <LinearGradient
                pointerEvents="none"
                colors={[theme.colors.surface, theme.colors.surface, `${theme.colors.surface}00`]}
                locations={[0, (safeArea.top + BAR_PADDING_TOP) / barBottom, 1]}
                style={[styles.fade, { height: barBottom }]}
            />
            <View style={[styles.bar, { top: safeArea.top }]}>
                <GlassSurface glass={liquidGlassAvailable} color={theme.colors.surfaceHigh} style={styles.field}>
                    <Ionicons name="search" size={19} color={theme.colors.textSecondary} />
                    <TextInput
                        ref={inputRef}
                        style={[styles.input, Typography.default()]}
                        value={field.value}
                        onChange={field.onChange}
                        onSubmitEditing={field.onSubmitEditing}
                        onEndEditing={field.onEndEditing}
                        placeholder={t('sessionScope.search')}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoFocus
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                    />
                    {/* The message search runs on after the other results show */}
                    {isSearchingMessages ? (
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : !!field.value && (
                        <Pressable
                            onPress={() => field.setText('')}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={t('common.clear')}
                        >
                            <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}
                </GlassSurface>
                <Pressable
                    onPress={() => router.back()}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionScope.close')}
                    style={({ pressed }) => pressed && styles.pressed}
                >
                    <GlassSurface glass={liquidGlassAvailable} color={theme.colors.surfaceHigh} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color={theme.colors.text} />
                    </GlassSurface>
                </Pressable>
            </View>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    scroll: {
        flex: 1,
    },
    nativeContent: {
        paddingBottom: 16,
    },
    headerField: {
        height: HEADER_FIELD_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: liquidGlassAvailable ? 14 : 8,
        paddingRight: HEADER_FIELD_PADDING_RIGHT,
        borderRadius: liquidGlassAvailable ? HEADER_FIELD_HEIGHT / 2 : 10,
    },
    inputSearching: {
        paddingRight: CLEAR_BUTTON_WIDTH,
    },
    headerSpinner: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: HEADER_FIELD_PADDING_RIGHT,
        width: CLEAR_BUTTON_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fade: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },
    bar: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingTop: BAR_PADDING_TOP,
        paddingBottom: BAR_PADDING_BOTTOM,
        paddingHorizontal: Platform.select({ ios: 16, default: 12 }),
    },
    field: {
        flex: 1,
        height: BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        borderRadius: BAR_HEIGHT / 2,
    },
    input: {
        flex: 1,
        height: '100%',
        paddingVertical: 0,
        fontSize: 17,
        color: theme.colors.text,
    },
    closeButton: {
        width: BAR_HEIGHT,
        height: BAR_HEIGHT,
        borderRadius: BAR_HEIGHT / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: {
        opacity: 0.6,
    },
}));
