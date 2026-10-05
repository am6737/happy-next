import * as React from 'react';
import { Text } from '@/components/StyledText';
import { useTickingNow } from '@/hooks/useTickingNow';
import { formatCompactDuration } from '@/utils/messageTime';

type Props = {
    /** Computes the duration at the given time; null means there is nothing to show yet. */
    resolve: (now: number) => number | null;
    /** Keep counting up every second, for something that is still running. */
    live: boolean;
    label?: string;
    style?: React.ComponentProps<typeof Text>['style'];
};

// A component of its own so the once-a-second refresh only re-renders this text, not the list around it.
export function OrchestratorDuration({ resolve, live, label, style }: Props) {
    const now = useTickingNow(live);
    const duration = resolve(now);
    if (duration === null) {
        return null;
    }
    return <Text style={style}>{label ? `${label}: ` : ''}{formatCompactDuration(duration)}</Text>;
}
