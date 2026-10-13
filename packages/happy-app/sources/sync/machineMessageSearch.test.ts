import { describe, expect, it, vi } from 'vitest';
import type { CachedMessageSearchMatch } from './messagesStore/cachedMessageSearch';

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC: vi.fn() } }));

import { mergeMessageSearchMatches } from './machineMessageSearch';

function match(sessionId: string, seq: number): CachedMessageSearchMatch {
    return { sessionId, snippet: `${sessionId}-${seq}`, messageId: `${sessionId}-m${seq}`, role: 'user', seq, createdAt: seq };
}

describe('mergeMessageSearchMatches', () => {
    it('keeps each message once, newest first, sessions in the given order', () => {
        const local = [match('a', 3), match('b', 1)];
        const machine = [match('b', 7), match('a', 3), match('a', 9)];
        expect(mergeMessageSearchMatches([local, machine], ['b', 'a']).map((hit) => hit.messageId))
            .toEqual(['b-m7', 'b-m1', 'a-m9', 'a-m3']);
    });

    it('drops sessions the app does not know and applies both limits', () => {
        const machine = [match('a', 1), match('a', 2), match('a', 3), match('gone', 5), match('b', 4)];
        expect(mergeMessageSearchMatches([machine], ['a', 'b'], 3, 2).map((hit) => hit.messageId))
            .toEqual(['a-m3', 'a-m2', 'b-m4']);
    });
});
