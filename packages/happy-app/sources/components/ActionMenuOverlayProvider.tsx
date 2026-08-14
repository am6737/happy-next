import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { Animated, TouchableWithoutFeedback, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { StyleSheet } from 'react-native-unistyles';
import { ActionMenu, ActionMenuItem } from './ActionMenu';

const ANIMATION_DURATION = 250;

interface OverlayEntry {
    id: string;
    items: ActionMenuItem[];
    onClose: () => void;
    onDismissed: () => void;
    title?: string;
    headerContent?: React.ReactNode;
    footerContent?: React.ReactNode;
    maxHeight?: number;
}

interface OverlayContextValue {
    present: (entry: OverlayEntry) => void;
    dismiss: (id: string) => void;
}

export const ActionMenuOverlayContext = createContext<OverlayContextValue | null>(null);

const styles = StyleSheet.create({
    provider: { flex: 1 },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 10000,
        elevation: 10000,
        justifyContent: 'flex-end',
        alignItems: 'center',
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

export function ActionMenuOverlayProvider({ children }: { children: React.ReactNode }) {
    const [entry, setEntry] = useState<OverlayEntry | null>(null);
    const entryRef = useRef<OverlayEntry | null>(null);
    const restoreKeyboardRef = useRef(false);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(100)).current;

    const present = useCallback((nextEntry: OverlayEntry) => {
        const isAlreadyVisible = entryRef.current?.id === nextEntry.id;
        entryRef.current = nextEntry;
        setEntry(nextEntry);

        if (isAlreadyVisible) return;

        restoreKeyboardRef.current = KeyboardController.isVisible();
        if (restoreKeyboardRef.current) {
            void KeyboardController.dismiss({ keepFocus: true });
        }

        fadeAnim.setValue(0);
        slideAnim.setValue(100);
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
    }, [fadeAnim, slideAnim]);

    const dismiss = useCallback((id: string) => {
        const dismissedEntry = entryRef.current;
        if (!dismissedEntry || dismissedEntry.id !== id) return;

        entryRef.current = null;
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
        ]).start(({ finished }) => {
            setEntry((current) => current?.id === id ? null : current);

            if (restoreKeyboardRef.current) {
                restoreKeyboardRef.current = false;
                KeyboardController.setFocusTo('current');
            }

            if (finished) dismissedEntry.onDismissed();
        });
    }, [fadeAnim, slideAnim]);

    const contextValue = useMemo(() => ({ present, dismiss }), [present, dismiss]);

    return (
        <ActionMenuOverlayContext.Provider value={contextValue}>
            <View style={styles.provider}>
                {children}
                {entry ? (
                    <View style={styles.overlay} accessibilityViewIsModal>
                        <TouchableWithoutFeedback onPress={entry.onClose}>
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
                                items={entry.items}
                                onClose={entry.onClose}
                                title={entry.title}
                                headerContent={entry.headerContent}
                                footerContent={entry.footerContent}
                                maxHeight={entry.maxHeight}
                            />
                        </Animated.View>
                    </View>
                ) : null}
            </View>
        </ActionMenuOverlayContext.Provider>
    );
}
