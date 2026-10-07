import * as React from 'react';
import { ViewStyle } from 'react-native';
import { StatusDot } from './StatusDot';
import type { SessionScopeDot as Dot } from './sessionListScope';

// The status dot of a machine or sharing view, as the old session-list tabs drew it:
// orange pulse when a session needs permission, blue pulse while one is thinking,
// static blue for an unread completion.
export const SessionScopeDot = React.memo(({ dot, size = 8, style }: { dot: Dot; size?: number; style?: ViewStyle }) => {
    if (dot === 'none') return null;
    return (
        <StatusDot
            color={dot === 'attention' ? '#FF9500' : '#007AFF'}
            isPulsing={dot === 'attention' || dot === 'thinking'}
            size={size}
            style={style}
        />
    );
});
