import { describe, expect, it } from 'vitest';
import { paginateSessionUserMessages, resolveSessionUserMessage } from './sessionUserMessages';

describe('sessionUserMessages', () => {
    const messages = Array.from({ length: 250 }, (_, index) => ({
        uuid: `uuid-${index}`,
        content: `prompt-${index}`,
        timestamp: new Date(index * 1000).toISOString(),
        index,
    }));

    it('paginates backwards from the latest user messages', () => {
        const first = paginateSessionUserMessages(messages, 100);
        expect(first.messages[0].index).toBe(150);
        expect(first.messages.at(-1)?.index).toBe(249);
        expect(first.hasMore).toBe(true);
        expect(first.nextBeforeIndex).toBe(150);

        const second = paginateSessionUserMessages(messages, 100, first.nextBeforeIndex!);
        expect(second.messages[0].index).toBe(50);
        expect(second.messages.at(-1)?.index).toBe(149);
        expect(second.hasMore).toBe(true);
    });

    it('uses full content for resolving even when the picker preview is truncated', () => {
        const longText = 'x'.repeat(800);
        const candidates = [{ uuid: 'long', content: longText, timestamp: new Date(1000).toISOString(), index: 0 }];
        const page = paginateSessionUserMessages(candidates, 100);
        expect(page.messages[0].content).toHaveLength(503);
        expect(resolveSessionUserMessage(candidates, { text: longText, createdAt: 1000 })?.uuid).toBe('long');
    });

    it('resolves messages on either side of compaction records by ignoring non-user records', () => {
        const candidates = [
            { uuid: 'before', content: 'before compact', timestamp: new Date(1000).toISOString(), index: 0 },
            { uuid: 'after', content: 'after compact', timestamp: new Date(3000).toISOString(), index: 1 },
        ];
        expect(resolveSessionUserMessage(candidates, { text: 'before compact', createdAt: 1000 })?.uuid).toBe('before');
        expect(resolveSessionUserMessage(candidates, { text: 'after compact', createdAt: 3000 })?.uuid).toBe('after');
    });
});
