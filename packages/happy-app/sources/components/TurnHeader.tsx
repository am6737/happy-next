import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { formatDuration, formatFullMessageTime } from '@/utils/messageTime';
import { TurnHeaderStatus } from './messageTurnTiming';
import { showToast } from './Toast';
import { hapticsLight } from './haptics';

/**
 * The line above an assistant turn: how long it has been going, or how long it
 * took. It belongs to the turn rather than to the list footer so it arrives with
 * the reply and stays put when the turn settles — a line that appeared and
 * disappeared on its own would jog everything above it.
 *
 * While the turn runs it counts up. Once it settles it just states the result: no
 * affordance, nothing that changes under the cursor. Tapping it still reveals the
 * exact window for anyone who wants it.
 */
export const TurnHeader = React.memo((props: { status: TurnHeaderStatus }) => {
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

    // The window behind that duration, for anyone who taps the line.
    const detail = running
        ? null
        : `${formatFullMessageTime(status.startedAt)} – ${formatFullMessageTime(status.completedAt)}`;

    const showDetail = () => {
        if (detail === null) return;
        hapticsLight();
        showToast(detail, { icon: null });
    };

    return (
        <Pressable
            style={styles.row}
            onPress={running ? undefined : showDetail}
            disabled={running}
            accessibilityLabel={label}
        >
            <Text style={styles.text} numberOfLines={1}>{label}</Text>
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
        paddingBottom: 4,
        marginBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    text: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));
