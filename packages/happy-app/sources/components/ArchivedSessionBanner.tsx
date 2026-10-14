import * as React from 'react';
import { View, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { GlassSurface } from '@/components/GlassSurface';
import { layout } from '@/components/layout';
import { hapticsLight } from '@/components/haptics';
import { Typography } from '@/constants/Typography';
import { useSessionFork } from '@/hooks/useSessionFork';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { canForkSession } from '@/utils/sessionLifecycle';
import { formatLastSeen } from '@/utils/sessionUtils';

/**
 * Takes the composer's place in an archived session, which is read-only: says when it was archived
 * and offers to resume it wherever its messages offer to fork.
 */
export const ArchivedSessionBanner = React.memo(({ session, glass }: { session: Session; glass: boolean }) => {
    const { theme } = useUnistyles();
    const { width: screenWidth } = useWindowDimensions();
    const { resumingSessionId, forkSession } = useSessionFork();
    const canResume = canForkSession(session);
    const resuming = resumingSessionId === session.id;
    // CLI-written archives carry the time; the app's own Codex archive only flips the state.
    const archivedAt = session.metadata?.lifecycleStateSince ?? session.activeAt;

    return (
        <View style={[styles.container, { paddingHorizontal: screenWidth > 700 ? 16 : 8 }]}>
            <GlassSurface glass={glass} color={theme.colors.input.background} style={[styles.card, { maxWidth: layout.maxWidth - 16 }]}>
                <View style={styles.row}>
                    <View style={styles.icon}>
                        <Ionicons name="archive-outline" size={16} color={theme.colors.textSecondary} />
                    </View>
                    <View style={styles.text}>
                        <Text style={styles.title} numberOfLines={1}>{t('session.archived.title')}</Text>
                        <Text style={styles.subtitle} numberOfLines={1}>{t('session.archived.archivedAgo', { time: formatLastSeen(archivedAt) })}</Text>
                    </View>
                    {canResume && (
                        <Pressable
                            style={({ pressed }) => [styles.button, { backgroundColor: theme.colors.button.primary.background }, pressed && styles.pressed]}
                            onPress={resuming ? undefined : () => { hapticsLight(); forkSession(session, 'resume'); }}
                            disabled={resuming}
                            accessibilityRole="button"
                        >
                            {resuming
                                ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                                : <Text style={[styles.buttonText, { color: theme.colors.button.primary.tint }]}>{t('session.archived.resume')}</Text>}
                        </Pressable>
                    )}
                </View>
            </GlassSurface>
        </View>
    );
});
ArchivedSessionBanner.displayName = 'ArchivedSessionBanner';

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    card: {
        width: '100%',
        borderRadius: 16,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    icon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfacePressed,
    },
    text: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    button: {
        borderRadius: 999,
        paddingHorizontal: 14,
        minHeight: 32,
        minWidth: 64,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: {
        opacity: 0.7,
    },
    buttonText: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
}));
