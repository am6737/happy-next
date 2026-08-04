/**
 * ActionMenuModal Component
 *
 * A modal wrapper that displays ActionMenu at the bottom of the screen.
 * Similar to iOS ActionSheet behavior.
 */

import React, { useContext, useEffect, useRef, useState } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    Platform,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { ActionMenuOverlayContext } from './ActionMenuOverlayProvider';

// On web, stop events from propagating to expo-router's modal overlay
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const webEventHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

interface ActionMenuModalProps {
    visible: boolean;
    items: ActionMenuItem[];
    onClose: () => void;
    /** If true, item.onPress will be called after modal is fully closed (for camera/gallery pickers) */
    deferItemPress?: boolean;
    /** Optional title displayed at the top of the menu */
    title?: string;
    headerContent?: React.ReactNode;
    footerContent?: React.ReactNode;
    maxHeight?: number;
}

const ANIMATION_DURATION = 250;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
        ...Platform.select({ web: { pointerEvents: 'auto' as const } }),
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'black',
    },
    content: {
        width: '100%',
        alignItems: 'center',
    },
});

function IOSActionMenuOverlay({ visible, items, onClose, deferItemPress, title, headerContent, footerContent, maxHeight }: ActionMenuModalProps) {
    const overlay = useContext(ActionMenuOverlayContext);
    const id = useRef(`action-menu-${Math.random().toString(36).slice(2)}`).current;
    const propsRef = useRef({ items, onClose, deferItemPress, title, headerContent, footerContent, maxHeight });
    const pendingActionRef = useRef<(() => void) | null>(null);
    propsRef.current = { items, onClose, deferItemPress, title, headerContent, footerContent, maxHeight };

    useEffect(() => {
        if (!overlay) return;

        if (!visible) {
            overlay.dismiss(id);
            return;
        }

        const current = propsRef.current;
        const overlayItems = current.deferItemPress
            ? current.items.map((item) => ({
                ...item,
                onPress: () => {
                    pendingActionRef.current = item.onPress;
                },
            }))
            : current.items;

        overlay.present({
            id,
            items: overlayItems,
            title: current.title,
            headerContent: current.headerContent,
            footerContent: current.footerContent,
            maxHeight: current.maxHeight,
            onClose: () => propsRef.current.onClose(),
            onDismissed: () => {
                const pendingAction = pendingActionRef.current;
                pendingActionRef.current = null;
                pendingAction?.();
            },
        });
    }, [id, overlay, visible]);

    useEffect(() => () => overlay?.dismiss(id), [id, overlay]);

    return null;
}

function NativeActionMenuModal({ visible, items, onClose, deferItemPress, title, headerContent, footerContent, maxHeight }: ActionMenuModalProps) {
    // Track actual modal visibility (delayed hide for animation)
    const [modalVisible, setModalVisible] = useState(false);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(100)).current;
    // Store pending action to execute after modal closes
    const pendingActionRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (visible) {
            // Show modal immediately, then animate in
            setModalVisible(true);
            // Reset animations to initial state
            fadeAnim.setValue(0);
            slideAnim.setValue(100);
            // Animate in
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    damping: 20,
                    stiffness: 300,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (modalVisible) {
            // Animate out, then hide modal
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.timing(slideAnim, {
                    toValue: 100,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setModalVisible(false);
                // Execute pending action after modal is fully closed
                if (pendingActionRef.current) {
                    // Add small delay to ensure modal is truly dismissed on iOS
                    setTimeout(() => {
                        pendingActionRef.current?.();
                        pendingActionRef.current = null;
                    }, 50);
                }
            });
        }
    }, [visible]);

    const handleClose = () => {
        onClose();
    };

    // Wrapped items that defer onPress if needed
    const wrappedItems = React.useMemo(() => {
        if (!deferItemPress) return items;
        return items.map(item => ({
            ...item,
            onPress: () => {
                // Store the action to execute after modal closes
                pendingActionRef.current = item.onPress;
            },
        }));
    }, [items, deferItemPress]);

    if (!modalVisible) {
        return null;
    }

    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="none"
            onRequestClose={handleClose}
        >
            <View style={styles.container} {...webEventHandlers}>
                <TouchableWithoutFeedback onPress={handleClose}>
                    <Animated.View
                        style={[
                            styles.backdrop,
                            {
                                opacity: fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 0.5],
                                }),
                            },
                        ]}
                    />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.content,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    <ActionMenu
                        items={wrappedItems}
                        onClose={handleClose}
                        title={title}
                        headerContent={headerContent}
                        footerContent={footerContent}
                        maxHeight={maxHeight}
                    />
                </Animated.View>
            </View>
        </Modal>
    );
}

export function ActionMenuModal(props: ActionMenuModalProps) {
    if (Platform.OS === 'ios') {
        return <IOSActionMenuOverlay {...props} />;
    }

    return <NativeActionMenuModal {...props} />;
}
