import { describe, expect, it } from 'vitest';
import { compareSessionsByLastMessage, updateSessionDisplayOrder } from './sessionLastMessageAt';

function session(id: string, lastMessageAt: number) {
    return { id, lastMessageAt, createdAt: 0 };
}

function order(sessions: ReturnType<typeof session>[]): string[] {
    updateSessionDisplayOrder(sessions);
    return [...sessions].sort(compareSessionsByLastMessage).map((s) => s.id);
}

describe('session display order', () => {
    it('orders new sessions by last message time', () => {
        expect(order([session('a', 1_000), session('b', 50_000), session('c', 20_000)])).toEqual(['b', 'c', 'a']);
    });

    it('keeps two sessions replying close together in place', () => {
        expect(order([session('x', 100_000), session('y', 99_000)])).toEqual(['x', 'y']);
        expect(order([session('x', 100_000), session('y', 105_000)])).toEqual(['x', 'y']);
        expect(order([session('x', 108_000), session('y', 105_000)])).toEqual(['x', 'y']);
        expect(order([session('x', 108_000), session('y', 113_000)])).toEqual(['x', 'y']);
    });

    it('lets a session overtake once it is more than 10s newer', () => {
        expect(order([session('x', 100_000), session('y', 99_000), session('z', 50_000)])).toEqual(['x', 'y', 'z']);
        expect(order([session('x', 100_000), session('y', 110_001), session('z', 50_000)])).toEqual(['y', 'x', 'z']);
        expect(order([session('x', 100_000), session('y', 110_001), session('z', 200_000)])).toEqual(['z', 'y', 'x']);
    });
});
