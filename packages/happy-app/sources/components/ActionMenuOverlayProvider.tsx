import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, TouchableWithoutFeedback, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { StyleSheet } from 'react-native-unistyles';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { liquidGlassAvailable } from './GlassSurface';

const ANIMATION_DURATION = 250;
// iOS 26 dims lightly behind its glass sheets and menus; a heavy dim would also darken the glass.
const BACKDROP_OPACITY = liquidGlassAvailable ? 0.2 : 0.5;
// Close to critically damped: the menu comes up quickly and settles with barely a bounce.
const SLIDE_SPRING = { damping: 32, stiffness: 300 };

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
    // On iOS 26 the menu stays mounted once shown, parked off screen between presentations: its
    // glass renders when first mounted but comes up blank when mounted again, so it is reused.
    const [shown, setShown] = useState(false);
    const entryRef = useRef<OverlayEntry | null>(null);
    const restoreKeyboardRef = useRef(false);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    // 0 = off screen, 1 = in place.
    const slideAnim = useRef(new Animated.Value(0)).current;
    // Glass does not render inside a view that is not fully opaque, so on iOS 26 the menu is not
    // faded in with the backdrop: it slides in by its own height, from just below the screen's
    // bottom edge, so all of the movement is on screen. Until it is measured, a screen's height.
    const [menuHeight, setMenuHeight] = useState(() => Dimensions.get('window').height);
    const slideDistance = liquidGlassAvailable ? menuHeight : 100;

    const present = useCallback((nextEntry: OverlayEntry) => {
        const isAlreadyVisible = entryRef.current?.id === nextEntry.id;
        entryRef.current = nextEntry;
        setEntry(nextEntry);
        setShown(true);

        if (isAlreadyVisible) return;

        restoreKeyboardRef.current = KeyboardController.isVisible();
        if (restoreKeyboardRef.current) {
            void KeyboardController.dismiss({ keepFocus: true });
        }

        fadeAnim.setValue(0);
        slideAnim.setValue(0);
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: ANIMATION_DURATION,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 1,
                ...SLIDE_SPRING,
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
                toValue: 0,
                duration: ANIMATION_DURATION,
                useNativeDriver: true,
            }),
        ]).start(({ finished }) => {
            // Unless another menu was presented while this one was on its way out.
            if (!entryRef.current) {
                if (liquidGlassAvailable) {
                    setShown(false);
                } else {
                    setEntry(null);
                }
            }

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
                    <View
                        style={styles.overlay}
                        pointerEvents={shown ? 'auto' : 'none'}
                        accessibilityViewIsModal={shown}
                        accessibilityElementsHidden={!shown}
                    >
                        <TouchableWithoutFeedback onPress={entry.onClose}>
                            <Animated.View
                                style={[
                                    styles.backdrop,
                                    {
                                        opacity: fadeAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0, BACKDROP_OPACITY],
                                        }),
                                    },
                                ]}
                            />
                        </TouchableWithoutFeedback>
                        <Animated.View
                            style={[
                                styles.content,
                                {
                                    opacity: liquidGlassAvailable ? 1 : fadeAnim,
                                    transform: [{
                                        translateY: slideAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [slideDistance, 0],
                                        }),
                                    }],
                                },
                            ]}
                            onLayout={(event) => setMenuHeight(event.nativeEvent.layout.height)}
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
