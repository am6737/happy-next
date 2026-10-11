import * as React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import type { StoredChannelMessage } from '@/sync/channelReducers';
import { delay } from '@/utils/time';

/**
 * Keeps an open channel live while its screen is focused.
 *
 * - Marks the channel visible (no notifications for it) and loads its latest page and the Agents.
 *   Load errors are never shown: it retries quietly with backoff until it succeeds or loses focus.
 * - Once loaded, and while the app is active and the screen focused, marks the newest confirmed
 *   message read after the list has been still for 250ms. A failed mark stays unread on the server
 *   and is tried again with the next message or focus.
 *
 * Returns whether the first load has finished.
 */
export function useChannelChat(id: string, messages: StoredChannelMessage[]): boolean {
    const focused = useIsFocused();
    const channel = storage(state => state.channels[id]);
    const [loaded, setLoaded] = React.useState(false);
    const [active, setActive] = React.useState(AppState.currentState === 'active');

    useFocusEffect(React.useCallback(() => {
        let cancelled = false;
        const stop = sync.channels.watch(id);
        void (async () => {
            for (let failures = 0; !cancelled; failures++) {
                try {
                    await Promise.all([sync.channels.load(id), sync.refreshTeammates()]);
                    if (!cancelled) setLoaded(true);
                    return;
                } catch {
                    await delay(Math.min(30_000, 1000 * 2 ** failures));
                }
            }
        })();
        return () => { cancelled = true; stop(); };
    }, [id]));

    React.useEffect(() => {
        const listener = AppState.addEventListener('change', state => setActive(state === 'active'));
        return () => listener.remove();
    }, []);

    React.useEffect(() => {
        if (!focused || !active || !loaded || !channel) return;
        const user = channel.members.find(member => member.memberType === 'user');
        const visibleSeq = Math.max(0, ...messages.filter(message => !message.delivery).map(message => message.seq));
        if (visibleSeq <= (user?.lastReadSeq ?? 0)) return;
        const timer = setTimeout(() => { void sync.channels.markRead(id, visibleSeq).catch(() => {}); }, 250);
        return () => clearTimeout(timer);
    }, [id, channel, messages, focused, active, loaded]);

    return loaded;
}
