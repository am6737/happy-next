/**
 * VoiceDetailSheet
 *
 * A bottom sheet (same visual language as DuplicateSheet) showing a single voice's
 * details: avatar, name + language flags, gender, full description, a preview
 * play/pause button, and a "use this voice" action.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Modal,
    TouchableWithoutFeedback,
    Animated,
    Platform,
    Pressable,
    PanResponder,
    ActivityIndicator,
    ViewStyle,
    TextStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './StyledText';
import { layout } from './layout';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { getVoiceName, getVoiceDescription, type Voice } from '@/constants/Voices';
import { t } from '@/text';
import { GlassSurface, liquidGlassAvailable } from './GlassSurface';
import { GLASS_SHEET_FILL, GLASS_SHEET_RADIUS, glassSheetFramePadding, SHEET_BACKDROP_OPACITY, SHEET_SLIDE_SPRING } from './glassSheet';

const ANIMATION_DURATION = 250;

interface VoiceDetailSheetProps {
    visible: boolean;
    voice: Voice | null;
    selected: boolean;
    onClose: () => void;
    onUse: (voiceType: string) => void;
    onClosed?: () => void;
}

export function VoiceDetailSheet({ visible, voice, selected, onClose, onUse, onClosed }: VoiceDetailSheetProps) {
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    const [modalVisible, setModalVisible] = useState(false);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    // 0 = off screen, 1 = in place.
    const slideAnim = useRef(new Animated.Value(0)).current;
    // The glass card slides by its own height (a screen's until measured, see `glassSheet`); the
    // solid sheet by 300.
    const [sheetHeight, setSheetHeight] = useState(0);
    const slideDistance = liquidGlassAvailable ? (sheetHeight || 1000) : 300;

    const { isPlaying, loading, toggle } = useVoicePreview(voice?.voiceType ?? '', voice?.trialUrl);

    // Stop preview when the sheet hides (it stays mounted, so unmount cleanup won't fire).
    useEffect(() => {
        if (!visible && isPlaying) toggle();
    }, [visible]);

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
            onPanResponderRelease: (_, g) => {
                if (g.vy > 0.5 || g.dy > 80) onClose();
            },
        }),
    ).current;

    useEffect(() => {
        if (visible) {
            setModalVisible(true);
            fadeAnim.setValue(0);
            slideAnim.setValue(0);
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: ANIMATION_DURATION, useNativeDriver: true }),
                Animated.spring(slideAnim, { toValue: 1, ...SHEET_SLIDE_SPRING, useNativeDriver: true }),
            ]).start();
        } else if (modalVisible) {
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 0, duration: ANIMATION_DURATION, useNativeDriver: true }),
                Animated.timing(slideAnim, { toValue: 0, duration: ANIMATION_DURATION, useNativeDriver: true }),
            ]).start(() => {
                setModalVisible(false);
                onClosed?.();
            });
        }
    }, [visible, onClosed]);

    if (!modalVisible || !voice) {
        return null;
    }

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose}>
            <View style={styles.container as ViewStyle}>
                <TouchableWithoutFeedback onPress={onClose}>
                    <Animated.View
                        style={[
                            styles.backdrop as ViewStyle,
                            { opacity: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, SHEET_BACKDROP_OPACITY] }) },
                        ]}
                    />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.sheetFrame as ViewStyle,
                        liquidGlassAvailable && glassSheetFramePadding(insets.bottom),
                        {
                            opacity: liquidGlassAvailable ? 1 : fadeAnim,
                            transform: [{
                                translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [slideDistance, 0] }),
                            }],
                        },
                    ]}
                    onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
                >
                    <GlassSurface
                        glass={liquidGlassAvailable}
                        color={theme.colors.surface}
                        style={[
                            styles.sheet as ViewStyle,
                            liquidGlassAvailable
                                ? styles.sheetGlass as ViewStyle
                                : [styles.sheetSolid as ViewStyle, { paddingBottom: insets.bottom + 16 }],
                        ]}
                    >
                        <View style={styles.handleContainer as ViewStyle} {...panResponder.panHandlers}>
                            <View style={styles.handle as ViewStyle} />
                        </View>

                        {/* Avatar + name + meta */}
                        <View style={styles.headerRow as ViewStyle}>
                            <Image
                                source={{ uri: voice.avatar }}
                                style={{ width: 72, height: 72, borderRadius: 36 }}
                                contentFit="cover"
                                transition={150}
                            />
                            <View style={styles.headerInfo as ViewStyle}>
                                <View style={styles.nameRow as ViewStyle}>
                                    <Text style={styles.name as TextStyle} numberOfLines={2}>
                                        {getVoiceName(voice)}
                                    </Text>
                                    {selected && (
                                        <Ionicons name="checkmark-circle" size={20} color="#007AFF" />
                                    )}
                                </View>
                                <View style={styles.metaRow as ViewStyle}>
                                    {!!voice.gender && <Text style={styles.metaText as TextStyle}>{voice.gender}</Text>}
                                    {!!voice.flags && <Text style={styles.metaText as TextStyle}>{voice.flags}</Text>}
                                </View>
                            </View>
                        </View>

                        {/* Description */}
                        {!!getVoiceDescription(voice) && (
                            <Text style={styles.description as TextStyle}>{getVoiceDescription(voice)}</Text>
                        )}

                        {/* Preview */}
                        <Pressable
                            style={({ pressed }) => [
                                styles.previewButton as ViewStyle,
                                liquidGlassAvailable && styles.previewButtonGlass as ViewStyle,
                                pressed && { opacity: 0.7 },
                            ]}
                            onPress={toggle}
                        >
                            {loading ? (
                                <ActivityIndicator size="small" color="#007AFF" />
                            ) : (
                                <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#007AFF" />
                            )}
                            <Text style={styles.previewText as TextStyle}>{t('settingsVoice.voicePreview')}</Text>
                        </Pressable>

                        {/* Use this voice */}
                        <Pressable
                            style={({ pressed }) => [styles.useButton as ViewStyle, pressed && styles.useButtonPressed as ViewStyle]}
                            onPress={() => onUse(voice.voiceType)}
                        >
                            <Text style={styles.useButtonText as TextStyle}>
                                {selected ? t('settingsVoice.voiceInUse') : t('settingsVoice.voiceUse')}
                            </Text>
                        </Pressable>
                    </GlassSurface>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'black',
    },
    sheetFrame: {
        width: '100%',
        maxWidth: Math.min(layout.maxWidth, 768),
    },
    sheet: {
        paddingHorizontal: 20,
    },
    sheetSolid: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sheetGlass: {
        borderRadius: GLASS_SHEET_RADIUS,
        paddingBottom: 20,
    },
    handleContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    handle: {
        width: 36,
        height: 5,
        backgroundColor: theme.colors.divider,
        borderRadius: 2.5,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        marginTop: 4,
    },
    headerInfo: {
        flex: 1,
        minWidth: 0,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    name: {
        fontSize: 20,
        fontWeight: '600',
        color: theme.colors.text,
        flexShrink: 1,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 6,
    },
    metaText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    description: {
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
        marginTop: 16,
    },
    previewButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 20,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surfacePressed,
    },
    previewButtonGlass: {
        backgroundColor: GLASS_SHEET_FILL,
    },
    previewText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#007AFF',
    },
    useButton: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
        paddingVertical: 14,
        borderRadius: 10,
        backgroundColor: '#007AFF',
    },
    useButtonPressed: {
        opacity: 0.85,
    },
    useButtonText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#fff',
    },
}));
