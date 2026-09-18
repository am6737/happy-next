import * as React from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { formatDuration, formatFullMessageTime, formatMessageTime } from '@/utils/messageTime';
import { TurnHeaderStatus } from './messageTurnTiming';
import { showToast } from './Toast';
import { hapticsLight } from './haptics';

/**
 * The line above an assistant turn: how long it has been going, or how long it
 * took. It belongs to the turn rather than to the list footer so it arrives with
 * the reply and stays put when the turn settles — a line that appeared and
 * disappeared on its own would jog everything above it.
 *
 * While the turn runs it counts up; once it settles it reads as a result, and the
 * exact start/end are a hover (web) or a tap (native) away.
 */
export const TurnHeader = React.memo((props: { status: TurnHeaderStatus }) => {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const { status } = props;
    const running = status.state === 'running';
    const elapsedMs = useElapsedMs(running ? status.startedAt : null);

    const label = running
        // Under a second there is nothing to report yet, so the line says what is
        // happening instead of how long it has been.
        ? (elapsedMs < 1000
            ? t('message.processing')
            : t('message.processed', { duration: formatDuration(elapsedMs) }))
        : t('message.took', { duration: formatDuration(status.completedAt - status.startedAt) });

    // The exact window behind that duration: shown in place while the cursor sits
    // on the line, and in full as the browser tooltip / native toast.
    const range = running
        ? null
        : `${formatMessageTime(status.startedAt)} – ${formatMessageTime(status.completedAt)}`;
    const detail = running
        ? null
        : `${formatFullMessageTime(status.startedAt)} – ${formatFullMessageTime(status.completedAt)}`;

    const text = range !== null && hovered ? `${range}, ${label}` : label;

    const showDetail = () => {
        if (detail === null) return;
        hapticsLight();
        showToast(detail, { icon: null });
    };

    // Spread rather than named props: Pressable's types have no mouse handlers,
    // but the web build renders it as a DOM node that receives them.
    const hoverHandlers = Platform.OS === 'web'
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
        }
        : {};

    return (
        <Pressable
            style={styles.row}
            onPress={running ? undefined : showDetail}
            disabled={running}
            accessibilityLabel={label}
            {...hoverHandlers}
        >
            {Platform.OS === 'web' ? (
                // react-native-web drops the DOM `title` prop, so the full window
                // rides on a plain DOM node, as the action bar's time does.
                <span title={detail ?? undefined} style={{ display: 'inline-flex' }}>
                    <Text style={styles.text} numberOfLines={1}>{text}</Text>
                </span>
            ) : (
                <Text style={styles.text} numberOfLines={1}>{text}</Text>
            )}
            {!running && (
                <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
            )}
        </Pressable>
    );
});

// Ticks once a second while a turn is in flight; a settled one reads its duration
// straight off the turn's timestamps.
function useElapsedMs(startedAt: number | null): number {
    const [elapsedMs, setElapsedMs] = React.useState(0);
    React.useEffect(() => {
        if (startedAt === null) return;
        const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [startedAt]);
    return startedAt === null ? 0 : elapsedMs;
}

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingBottom: 4,
        marginBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    text: {
        // Single line, and free to shrink: the hover detail is longer than the
        // label and must not push the chevron off the row.
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));
