import React, { useEffect, useRef } from 'react';
import {
    View,
    TouchableWithoutFeedback,
    Animated,
    KeyboardAvoidingView,
    BackHandler,
    Platform
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

const isWeb = Platform.OS === 'web';
const OPEN_MS = 200;
const CLOSE_MS = 150;

interface CommandPaletteModalProps {
    visible: boolean;
    onHide: () => void;
    children: React.ReactNode;
}

// An overlay rather than a Modal: a Modal unmounts its content when hidden, but the palette must stay mounted
// so that reopening it shows exactly what was left — query, results, history list, scroll position
export function CommandPaletteModal({
    visible,
    onHide,
    children
}: CommandPaletteModalProps) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.95)).current;
    // Stays false through the closing animation, so the palette fades out before it is hidden
    const [isClosed, setIsClosed] = React.useState(!visible);
    // Web only: the target of the CSS transition. Animated has no native driver on web, so it would recompute
    // the whole palette's style on the JS thread every frame; a CSS opacity/transform transition runs on the compositor
    const [isShown, setIsShown] = React.useState(false);

    useEffect(() => {
        if (isWeb) {
            if (visible) {
                setIsClosed(false);
                // One frame at the hidden values first, so the transition has a starting point
                const frame = requestAnimationFrame(() => setIsShown(true));
                return () => cancelAnimationFrame(frame);
            }
            setIsShown(false);
            const timer = setTimeout(() => setIsClosed(true), CLOSE_MS);
            return () => clearTimeout(timer);
        }
        if (visible) {
            setIsClosed(false);
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: OPEN_MS,
                    useNativeDriver: true
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 10,
                    tension: 60,
                    useNativeDriver: true
                })
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: CLOSE_MS,
                    useNativeDriver: true
                }),
                Animated.timing(scaleAnim, {
                    toValue: 0.95,
                    duration: CLOSE_MS,
                    useNativeDriver: true
                })
            ]).start(({ finished }) => {
                if (finished) setIsClosed(true);
            });
        }
        return undefined;
    }, [visible, fadeAnim, scaleAnim]);

    const webTransition = isShown ? styles.webTransitionIn : styles.webTransitionOut;
    const backdropMotion = isWeb
        ? [webTransition, { opacity: isShown ? 0.7 : 0 }]
        : { opacity: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] }) };
    const contentMotion = isWeb
        ? [webTransition, { opacity: isShown ? 1 : 0, transform: [{ scale: isShown ? 1 : 0.95 }] }]
        : { opacity: fadeAnim, transform: [{ scale: scaleAnim }] };

    useEffect(() => {
        if (Platform.OS !== 'android' || !visible) return;
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            onHide();
            return true;
        });
        return () => subscription.remove();
    }, [visible, onHide]);

    return (
        <View
            style={[styles.overlay, !visible && isClosed && styles.hidden]}
            pointerEvents={visible ? 'auto' : 'none'}
        >
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <TouchableWithoutFeedback onPress={onHide}>
                    <Animated.View style={[styles.backdrop, backdropMotion]} />
                </TouchableWithoutFeedback>

                <Animated.View style={[styles.content, contentMotion]}>
                    {children}
                </Animated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
        elevation: 1000,
        ...(Platform.OS === 'web' ? {
            position: 'fixed',
        } as any : {}),
    },
    // On web the hidden palette keeps its layout, so showing it again needs no relayout of the results
    hidden: Platform.OS === 'web' ? {
        visibility: 'hidden',
    } as any : {
        display: 'none',
    },
    webTransitionIn: {
        transitionProperty: 'opacity, transform',
        transitionDuration: `${OPEN_MS}ms`,
        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'opacity, transform',
    } as any,
    webTransitionOut: {
        transitionProperty: 'opacity, transform',
        transitionDuration: `${CLOSE_MS}ms`,
        transitionTimingFunction: 'ease-in',
        willChange: 'opacity, transform',
    } as any,
    container: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'center',
        // Position at 30% from top of viewport
        ...(Platform.OS === 'web' ? {
            paddingTop: '10vh',
        } as any : {
            paddingTop: 24,
            paddingBottom: 24,
        })
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.dark ? '#000000' : '#0F172A',
        // Remove blur for better performance - use darker overlay instead
        // Blur can be re-enabled if needed but with optimizations
        ...(Platform.OS === 'web' ? {
            // backdropFilter: 'blur(2px)',
            // WebkitBackdropFilter: 'blur(2px)',
            // willChange: 'backdrop-filter',
            // transform: 'translateZ(0)', // Force GPU acceleration
        } as any : {})
    },
    content: {
        zIndex: 1,
        width: '90%',
        maxWidth: 800, // Increased from 640
    }
}));
