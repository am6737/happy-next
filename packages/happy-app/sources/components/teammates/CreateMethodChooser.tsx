import React from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const SIDE_BY_SIDE_WIDTH = 640;

function MethodCard({ icon, title, description, badge, note, highlighted = false, onPress }: {
    icon: IconName; title: string; description: string; badge?: string; note?: string; highlighted?: boolean; onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={description}
            onPress={onPress}
            style={({ pressed }) => [styles.card, highlighted && styles.cardHighlighted, pressed && styles.cardPressed]}
        >
            <View style={styles.cardTop}>
                <View style={[styles.icon, highlighted && styles.iconHighlighted]}>
                    <Ionicons name={icon} size={26} color={theme.colors.textLink} />
                </View>
                {badge && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{badge}</Text>
                    </View>
                )}
            </View>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardDescription}>{description}</Text>
            {note && <Text style={styles.cardNote}>{note}</Text>}
            <View style={styles.cardAction}>
                <Text style={styles.cardActionText}>{t('common.continue')}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textLink} />
            </View>
        </Pressable>
    );
}

/** First step of creating an Agent: describe it to AI, or fill in the wizard by hand. */
export function CreateMethodChooser() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const machines = useAllMachines();
    const online = machines.some(isMachineOnline);
    const sideBySide = width >= SIDE_BY_SIDE_WIDTH;

    return (
        <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
            <View style={styles.intro}>
                <Text style={styles.title}>{t('teammates.method.title')}</Text>
                <Text style={styles.subtitle}>{t('teammates.method.subtitle')}</Text>
            </View>
            <View style={[styles.cards, sideBySide && styles.cardsRow]}>
                <View style={sideBySide && styles.cardSlot}>
                    <MethodCard
                        icon="sparkles"
                        title={t('teammates.method.aiTitle')}
                        description={t('teammates.method.aiDescription')}
                        badge={t('teammates.method.recommended')}
                        // Stays tappable without an online machine: the AI page explains what is missing.
                        note={online ? undefined : t('teammates.method.needsMachine')}
                        highlighted
                        onPress={() => router.push('/teammates/new/ai')}
                    />
                </View>
                <View style={sideBySide && styles.cardSlot}>
                    <MethodCard
                        icon="create-outline"
                        title={t('teammates.method.manualTitle')}
                        description={t('teammates.method.manualDescription')}
                        onPress={() => router.push('/teammates/new/manual')}
                    />
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        gap: 20,
        padding: 16,
        paddingTop: 24,
    },
    intro: {
        gap: 6,
        paddingHorizontal: 4,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 26,
        color: theme.colors.text,
    },
    subtitle: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 21,
        color: theme.colors.textSecondary,
    },
    cards: {
        gap: 14,
    },
    cardsRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
    },
    cardSlot: {
        flex: 1,
    },
    card: {
        flexGrow: 1,
        gap: 8,
        padding: 20,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    cardHighlighted: {
        borderWidth: 1.5,
        borderColor: theme.colors.textLink,
    },
    cardPressed: {
        opacity: 0.85,
    },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    icon: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    iconHighlighted: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: theme.colors.textLink,
    },
    badgeText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        color: theme.colors.button.primary.tint,
    },
    cardTitle: {
        ...Typography.default('semiBold'),
        fontSize: 19,
        color: theme.colors.text,
    },
    cardDescription: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    cardNote: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.warning,
    },
    cardAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
    },
    cardActionText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.textLink,
    },
}));
