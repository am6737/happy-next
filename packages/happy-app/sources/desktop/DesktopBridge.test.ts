import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from '@/sync/typesRaw';
import {
    agentMessagePreview,
    isReadyEvent,
    notificationId,
    otherUserMessagePreview,
    sessionIdFromPath,
} from './desktopNotificationUtils';

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

    it('separates agent completion content from immediately notifiable user messages', () => {
        expect(agentMessagePreview(message({
            role: 'agent',
            content: [{ type: 'text', text: 'Done', uuid: 'u', parentUUID: null }],
        }))).toBe('Done');
        expect(otherUserMessagePreview(message({
            role: 'user',
            sentBy: 'me',
            content: { type: 'text', text: 'my message' },
        }), 'me')).toBeNull();
        expect(otherUserMessagePreview(message({
            role: 'user',
            sentBy: 'friend',
            content: { type: 'text', text: 'hello' },
        }), 'me')).toBe('hello');
        expect(isReadyEvent(message({
            role: 'event',
            content: { type: 'ready' },
        }))).toBe(true);
    });

    it('removes all line breaks from notification bodies', () => {
        expect(agentMessagePreview(message({
            role: 'agent',
            content: [
                { type: 'text', text: 'First line\r\n\n   \r\nSecond line', uuid: 'u1', parentUUID: null },
                { type: 'text', text: 'Third\u2028line', uuid: 'u2', parentUUID: null },
            ],
        }))).toBe('First line Second line Third line');
        expect(otherUserMessagePreview(message({
            role: 'user',
            sentBy: 'friend',
            content: { type: 'text', text: 'Hello\n\n\nworld' },
        }), 'me')).toBe('Hello world');
    });

    it('uses plain-text previews for Markdown messages', () => {
        expect(agentMessagePreview(message({
            role: 'agent',
            content: [{
                type: 'text',
                text: '## **Done**\n```ts\nconst hidden = true;\n```\n[Open details](https://example.com)',
                uuid: 'u',
                parentUUID: null,
            }],
        }))).toBe('Done [Code] Open details');
    });

    it('creates stable positive 32-bit notification IDs', () => {
        expect(notificationId('session-a')).toBe(notificationId('session-a'));
        expect(notificationId('session-a')).toBeGreaterThan(0);
        expect(notificationId('session-a')).toBeLessThanOrEqual(0x7fffffff);
    });

});
