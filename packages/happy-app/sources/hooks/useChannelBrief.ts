import * as React from 'react';
import type { Channel } from 'happy-wire';
import { sync } from '@/sync/sync';

/**
 * Decrypts a group's brief with the channel key whenever its ciphertext changes. Returns undefined while the
 * current ciphertext is being opened, and null when there is no brief or it cannot be read.
 */
export function useChannelBrief(channel: Channel | undefined): string | null | undefined {
    const [opened, setOpened] = React.useState<{ brief: string | null; text: string | null } | null>(null);
    const brief = channel?.brief ?? null;
    React.useEffect(() => {
        if (!channel) return;
        let cancelled = false;
        void sync.channels.readBrief(channel).then(text => {
            if (!cancelled) setOpened({ brief, text });
        });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new ciphertext needs decrypting
    }, [channel?.id, brief]);
    return opened && opened.brief === brief ? opened.text : undefined;
}
