import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from '@/sync/typesRaw';
import { messagePreview, notificationId, sessionIdFromPath } from './desktopNotificationUtils';

function message(value: Partial<NormalizedMessage>): NormalizedMessage {
    return {
        id: 'message-1',
        localId: null,
        createdAt: 1,
        isSidechain: false,
        role: 'agent',
        content: [],
        ...value,
    } as NormalizedMessage;
}

describe('DesktopBridge helpers', () => {
    it('extracts real session IDs from routes', () => {
        expect(sessionIdFromPath('/session/abc%20123')).toBe('abc 123');
        expect(sessionIdFromPath('/session/recent')).toBeNull();
        expect(sessionIdFromPath('/settings')).toBeNull();
    });

    it('only previews messages worth notifying about', () => {
        expect(messagePreview(message({
            role: 'agent',
            content: [{ type: 'text', text: 'Done', uuid: 'u', parentUUID: null }],
        }), 'me')).toBe('Done');
        expect(messagePreview(message({
            role: 'user',
            sentBy: 'me',
            content: { type: 'text', text: 'my message' },
        }), 'me')).toBeNull();
        expect(messagePreview(message({
            role: 'user',
            sentBy: 'friend',
            content: { type: 'text', text: 'hello' },
        }), 'me')).toBe('hello');
    });

    it('creates stable positive 32-bit notification IDs', () => {
        expect(notificationId('session-a')).toBe(notificationId('session-a'));
        expect(notificationId('session-a')).toBeGreaterThan(0);
        expect(notificationId('session-a')).toBeLessThanOrEqual(0x7fffffff);
    });
});
