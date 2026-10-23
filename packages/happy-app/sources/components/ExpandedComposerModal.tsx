import * as React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { MaterialCommunityIcons, Octicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { hapticsLight } from './haptics';
import { t } from '@/text';

const isIOS = Platform.OS === 'ios';

interface ExpandedComposerModalProps {
    visible: boolean;
    value: string;
    placeholder?: string;
    onChangeText: (text: string) => void;
    onClose: () => void;
    /** Sends what is in the field. The modal closes itself once the text is cleared by the send. */
    onSend: (text: string) => void;
    canSend: boolean;
    isSending?: boolean;
}

// The composer's text on a page of its own, for writing something long: the same text as the
// composer, so closing it leaves everything where it was, and a send button that sends as the
// composer's does.
export const ExpandedComposerModal = React.memo(function ExpandedComposerModal(props: ExpandedComposerModalProps) {
    const { visible, value, onClose } = props;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    // Keyboard height as it animates, negative upwards.
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

    // iOS shows a page sheet, which reaches the bottom of the screen: the page follows the keyboard
    // frame by frame and rests above the home indicator.
    const bottomInset = safeArea.bottom;
    const pageAnimatedStyle = useAnimatedStyle(() => (
        isIOS ? { paddingBottom: Math.max(-keyboardHeight.value, bottomInset) } : {}
    ), [bottomInset]);

    // Closes once a send from here clears the text, and stays open if the send doesn't go through.
    const sentRef = React.useRef(false);
    React.useEffect(() => {
        if (sentRef.current && !value.trim()) {
            sentRef.current = false;
            onClose();
        }
    }, [value, onClose]);
    React.useEffect(() => {
        if (!visible) {
            sentRef.current = false;
        }
    }, [visible]);

    const handleSend = () => {
        if (!props.canSend || props.isSending) return;
        hapticsLight();
        sentRef.current = true;
        props.onSend(value);
    };

    const sendActive = props.canSend || !!props.isSending;

    const page = (
        <Animated.View
            style={[
                styles.page,
                // The page sheet starts below the status bar; elsewhere the page is the whole screen.
                !isIOS && { paddingTop: safeArea.top, paddingBottom: safeArea.bottom },
                pageAnimatedStyle,
            ]}
        >
            <View style={styles.header}>
                <Pressable
                    onPress={onClose}
                    hitSlop={10}
                    style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t('agentInput.collapse')}
                >
                    <MaterialCommunityIcons name="arrow-collapse" size={20} color={theme.colors.text} />
                </Pressable>
            </View>
            <TextInput
                style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
                value={value}
                onChangeText={(text) => {
                    sentRef.current = false;
                    props.onChangeText(text);
                }}
                placeholder={props.placeholder}
                placeholderTextColor={theme.colors.input.placeholder}
                multiline
                autoFocus
                textAlignVertical="top"
                autoComplete="off"
                textContentType="none"
                submitBehavior="newline"
            />
            <View style={styles.footer}>
                <Pressable
                    onPress={handleSend}
                    disabled={!props.canSend || props.isSending}
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.sendButton,
                        sendActive ? styles.sendButtonActive : styles.sendButtonInactive,
                        pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !props.canSend || !!props.isSending }}
                >
                    {props.isSending ? (
                        <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                    ) : (
                        <Octicons name="arrow-up" size={18} color={theme.colors.button.primary.tint} />
                    )}
                </Pressable>
            </View>
        </Animated.View>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle={isIOS ? 'pageSheet' : undefined}
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onClose}
        >
            {isIOS ? page : (
                <KeyboardAvoidingView style={styles.keyboardContainer} behavior="height" enabled={Platform.OS === 'android'}>
                    {page}
                </KeyboardAvoidingView>
            )}
        </Modal>
    );
});

const styles = StyleSheet.create((theme) => ({
    keyboardContainer: {
        flex: 1,
    },
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 12,
        paddingTop: 12,
    },
    headerButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    input: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 8,
        fontSize: 17,
        lineHeight: 24,
        color: theme.colors.input.text,
        ...Typography.default(),
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingTop: 8,
        paddingRight: 16,
        paddingBottom: 16,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    pressed: {
        opacity: 0.7,
    },
}));
