import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from '@/sync/typesRaw';
import type { Session } from '@/sync/storageTypes';
import {
    agentMessagePreview,
    countDesktopAttentionSessions,
    isReadyEvent,
    notificationId,
    otherUserMessagePreview,
    sessionNeedsDesktopAttention,
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

function session(value: Partial<Session> & Pick<Session, 'id'>): Session {
    return {
        active: true,
        agentState: null,
        metadata: null,
        ...value,
    } as Session;
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

    it('uses the same completion dismissal semantics for desktop attention', () => {
        const completed = session({
            id: 'completed',
            agentState: { taskCompleted: 200 } as Session['agentState'],
            metadata: { completionDismissedAt: 100 } as Session['metadata'],
        });

        expect(sessionNeedsDesktopAttention(completed, 150, 300)).toBe(true);
        expect(sessionNeedsDesktopAttention(completed, 200, 300)).toBe(false);
        expect(sessionNeedsDesktopAttention({
            ...completed,
            metadata: { completionDismissedAt: 200 } as Session['metadata'],
        }, 0, 300)).toBe(false);
    });

    it('counts pending permissions and completion once per session', () => {
        const needsPermission = session({
            id: 'attention',
            agentState: {
                taskCompleted: 200,
                requests: {
                    request1: { tool: 'Bash', arguments: {}, createdAt: 250 },
                },
            } as Session['agentState'],
        });

        expect(countDesktopAttentionSessions(
            { attention: needsPermission },
            { attention: needsPermission },
            new Map(),
            300,
        )).toBe(1);
    });

    it('does not persist an attention indicator for ordinary sessions', () => {
        expect(countDesktopAttentionSessions(
            { idle: session({ id: 'idle' }) },
            {},
            new Map(),
            300,
        )).toBe(0);
    });

});
