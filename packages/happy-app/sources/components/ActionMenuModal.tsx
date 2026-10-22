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
    Platform,
} from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
    // Reanimated rather than Animated's native driver: a native-driven slide never reaches the
    // shadow tree, which then keeps the sheet 100 lower than it is drawn, and Android drops the
    // first tap on a row as having slid off it. Reanimated commits each frame to the shadow tree.
    const fade = useSharedValue(0);
    const slide = useSharedValue(100);
    // Store pending action to execute after modal closes
    const pendingActionRef = useRef<(() => void) | null>(null);

    const handleHidden = () => {
        setModalVisible(false);
        // Execute pending action after modal is fully closed
        if (pendingActionRef.current) {
            // Add small delay to ensure modal is truly dismissed on iOS
            setTimeout(() => {
                pendingActionRef.current?.();
                pendingActionRef.current = null;
            }, 50);
        }
    };

    useEffect(() => {
        if (visible) {
            // Show modal immediately, then animate in
            setModalVisible(true);
            // Reset animations to initial state, then animate in
            fade.value = 0;
            slide.value = 100;
            fade.value = withTiming(1, { duration: ANIMATION_DURATION });
            slide.value = withTiming(0, { duration: ANIMATION_DURATION, easing: Easing.out(Easing.cubic) });
        } else if (modalVisible) {
            // Animate out, then hide modal
            fade.value = withTiming(0, { duration: ANIMATION_DURATION });
            slide.value = withTiming(100, { duration: ANIMATION_DURATION, easing: Easing.in(Easing.cubic) }, (finished) => {
                if (finished) runOnJS(handleHidden)();
            });
        }
    }, [visible]);

    const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value * 0.5 }));
    const contentStyle = useAnimatedStyle(() => ({
        opacity: fade.value,
        transform: [{ translateY: slide.value }],
    }));

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
                    <Animated.View style={[styles.backdrop, backdropStyle]} />
                </TouchableWithoutFeedback>

                <Animated.View style={[styles.content, contentStyle]}>
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

// Memoized: it stays mounted while closed, under screens that re-render often.
export const ActionMenuModal = React.memo(function ActionMenuModal(props: ActionMenuModalProps) {
    if (Platform.OS === 'ios') {
        return <IOSActionMenuOverlay {...props} />;
    }

    return <NativeActionMenuModal {...props} />;
});
