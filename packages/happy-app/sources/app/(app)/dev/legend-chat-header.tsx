import * as React from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type ScrollViewProps } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentContentView } from '@/components/AgentContentView';
import { ChatScrollView } from '@/components/ChatScrollView';
import { GlassSurface } from '@/components/GlassSurface';
import { COMPOSER_MARGIN, floatingComposerAvailable, floatingComposerBottomInset } from '@/components/floatingComposer';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';

type DemoMessage = {
    id: string;
    text: string;
    side: 'left' | 'right';
};

function createInitialMessages(): DemoMessage[] {
    return Array.from({ length: 30 }, (_, index) => ({
        id: `initial-${index + 1}`,
        text: index % 5 === 0
            ? `Message ${index + 1}: This is a longer row used to verify dynamic heights while scrolling beneath the transparent native header.`
            : `Message ${index + 1}`,
        side: index % 2 === 0 ? 'left' : 'right',
    }));
}

export default function LegendChatHeaderTest() {
    const [messages, setMessages] = React.useState<DemoMessage[]>(createInitialMessages);
    const [input, setInput] = React.useState('');
    const nextMessageIdRef = React.useRef(31);
    const olderPageRef = React.useRef(0);
    const softHeaderInset = useSoftHeaderInset();
    const insets = useSafeAreaInsets();
    // Written by AgentContentView as the floating composer lays out, read by the list on the UI thread.
    const composerHeight = useSharedValue(0);
    const composerInset = floatingComposerAvailable ? composerHeight : undefined;
    const inputRef = React.useRef<TextInput>(null);

    const addMessage = React.useCallback(() => {
        const text = input.trim();
        if (!text) return;
        const id = nextMessageIdRef.current++;
        setMessages((current) => [...current, { id: `new-${id}`, text, side: 'right' }]);
        setInput('');
    }, [input]);

    const prependOlderPage = React.useCallback(() => {
        const page = ++olderPageRef.current;
        const older = Array.from({ length: 10 }, (_, index): DemoMessage => ({
            id: `older-${page}-${index}`,
            text: `Older page ${page}, row ${index + 1}`,
            side: index % 2 === 0 ? 'left' : 'right',
        }));
        setMessages((current) => [...older, ...current]);
    }, []);

    const renderItem = React.useCallback(({ item }: { item: DemoMessage }) => (
        <View style={[styles.messageRow, item.side === 'right' ? styles.messageRowRight : styles.messageRowLeft]}>
            <View style={[styles.messageBubble, item.side === 'right' ? styles.messageBubbleRight : styles.messageBubbleLeft]}>
                <Text style={styles.messageText}>{item.text}</Text>
            </View>
        </View>
    ), []);

    const listHeader = React.useMemo(() => (
        <View>
            <View style={{ height: softHeaderInset + 12 }} />
            <View style={styles.testInfo}>
                <Text style={styles.testInfoTitle}>LegendList without inverted</Text>
                <Text style={styles.testInfoText}>
                    Scroll messages beneath the native header and verify the iOS 26 soft edge effect. Use “Load older” to test prepend anchoring.
                </Text>
                <Pressable onPress={prependOlderPage} style={styles.loadOlderButton}>
                    <Text style={styles.loadOlderText}>Load older</Text>
                </Pressable>
            </View>
        </View>
    ), [prependOlderPage, softHeaderInset]);

    const renderScrollComponent = React.useCallback(
        (props: ScrollViewProps) => (
            <ChatScrollView
                {...props}
                bottomInset={composerInset ? floatingComposerBottomInset(insets.bottom) : insets.bottom}
                topInset={softHeaderInset}
                composerInset={composerInset}
            />
        ),
        [composerInset, insets.bottom, softHeaderInset],
    );

    const list = (
        <LegendList
            data={messages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            estimatedItemSize={64}
            alignItemsAtEnd
            maintainScrollAtEnd={{ on: { dataChange: true } }}
            maintainScrollAtEndThreshold={0.2}
            maintainVisibleContentPosition
            initialScrollAtEnd
            ListHeaderComponent={listHeader}
            estimatedHeaderSize={softHeaderInset + 12}
            renderScrollComponent={renderScrollComponent}
            contentContainerStyle={{ paddingBottom: COMPOSER_MARGIN }}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
        />
    );

    const composer = (
        <View style={styles.inputSafeArea}>
            <GlassSurface
                glass={floatingComposerAvailable}
                style={[styles.inputContainer, !floatingComposerAvailable && styles.inputContainerFallback]}
            >
                <TextInput
                    ref={inputRef}
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={addMessage}
                    placeholder="Add a message"
                    returnKeyType="send"
                    // On glass the card is the field's background; a second one inside it is noise.
                    style={[styles.input, floatingComposerAvailable && styles.inputOnGlass]}
                />
                <Pressable onPress={addMessage} style={styles.sendButton}>
                    <Text style={styles.sendButtonText}>Send</Text>
                </Pressable>
            </GlassSurface>
        </View>
    );

    if (floatingComposerAvailable) {
        return (
            <View style={styles.container}>
                <AgentContentView floatingInput composerHeight={composerHeight} content={list} input={composer} />
            </View>
        );
    }

    return (
        <SafeAreaView edges={['bottom']} style={styles.container}>
            {list}
            <KeyboardStickyView offset={{ opened: Platform.OS === 'ios' ? insets.bottom - COMPOSER_MARGIN : insets.bottom }}>
                {composer}
            </KeyboardStickyView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F2F2F7',
    },
    list: {
        flex: 1,
    },
    testInfo: {
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.88)',
    },
    testInfoTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1C1C1E',
    },
    testInfoText: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: '#636366',
    },
    loadOlderButton: {
        alignSelf: 'flex-start',
        marginTop: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 14,
        backgroundColor: '#007AFF',
    },
    loadOlderText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },
    messageRow: {
        paddingHorizontal: 16,
        marginVertical: 5,
    },
    messageRowLeft: {
        alignItems: 'flex-start',
    },
    messageRowRight: {
        alignItems: 'flex-end',
    },
    messageBubble: {
        maxWidth: '82%',
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 16,
    },
    messageBubbleLeft: {
        backgroundColor: '#FFFFFF',
    },
    messageBubbleRight: {
        backgroundColor: '#D9FDD3',
    },
    messageText: {
        color: '#1C1C1E',
        fontSize: 15,
        lineHeight: 20,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 8,
        borderRadius: 28,
        overflow: 'hidden',
    },
    inputContainerFallback: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(198,198,200,0.75)',
        backgroundColor: 'rgba(249,249,249,0.62)',
    },
    inputSafeArea: {
        paddingTop: 8,
        paddingHorizontal: 12,
        paddingBottom: COMPOSER_MARGIN,
    },
    input: {
        flex: 1,
        minHeight: 40,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        color: '#1C1C1E',
    },
    inputOnGlass: {
        backgroundColor: 'transparent',
    },
    sendButton: {
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: 15,
        borderRadius: 20,
        backgroundColor: '#007AFF',
    },
    sendButtonText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
});
