import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    StyleSheet,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

// On web, stop events from propagating to expo-router's modal overlay
// which intercepts clicks when it applies pointer-events: none to body
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const webEventHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

interface BaseModalProps {
    visible: boolean;
    onClose?: () => void;
    children: React.ReactNode;
    animationType?: 'fade' | 'slide' | 'none';
    transparent?: boolean;
    closeOnBackdrop?: boolean;
    /** Runs once the modal has faded out after `visible` turned false. */
    onExited?: () => void;
}

export function BaseModal({
    visible,
    onClose,
    children,
    animationType = 'fade',
    transparent = true,
    closeOnBackdrop = true,
    onExited
}: BaseModalProps) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    // Stays mounted while it fades out, so closing is animated like opening
    const [mounted, setMounted] = useState(visible);
    const onExitedRef = useRef(onExited);
    onExitedRef.current = onExited;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true
            }).start();
        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true
            }).start(({ finished }) => {
                if (!finished) return;
                setMounted(false);
                onExitedRef.current?.();
            });
        }
    }, [visible, fadeAnim]);

    const handleBackdropPress = () => {
        if (closeOnBackdrop && onClose) {
            onClose();
        }
    };

    const content = (
        <KeyboardAvoidingView
            // Fading out, it no longer takes touches
            style={[styles.container, !visible && styles.exiting]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            {...webEventHandlers}
        >
            <TouchableWithoutFeedback onPress={handleBackdropPress}>
                <Animated.View
                    style={[
                        styles.backdrop,
                        {
                            opacity: fadeAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, 0.5]
                            })
                        }
                    ]}
                />
            </TouchableWithoutFeedback>

            <Animated.View
                style={[
                    styles.content,
                    {
                        opacity: fadeAnim,
                        transform: [{
                            scale: fadeAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.9, 1]
                            })
                        }]
                    }
                ]}
            >
                {children}
            </Animated.View>
        </KeyboardAvoidingView>
    );

    if (Platform.OS === 'ios' && transparent) {
        if (!mounted) {
            return null;
        }

        return (
            <FullWindowOverlay>
                {content}
            </FullWindowOverlay>
        );
    }

    return (
        <Modal
            visible={mounted}
            transparent={transparent}
            animationType={animationType}
            onRequestClose={onClose}
            presentationStyle={transparent ? 'overFullScreen' : 'fullScreen'}
            statusBarTranslucent={transparent}
            navigationBarTranslucent={transparent}
        >
            {content}
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
        // On web, ensure modal can receive pointer events when body has pointer-events: none
        ...Platform.select({ web: { pointerEvents: 'auto' as const } })
    },
    exiting: {
        pointerEvents: 'none'
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'black'
    },
    content: {
        zIndex: 1
    }
});