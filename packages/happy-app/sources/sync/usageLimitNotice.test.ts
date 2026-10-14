import { describe, it, expect } from 'vitest';
import { limitNoticeTimeStart, parseLimitNoticeResetsAt, rejectedLimitResetsAt } from './usageLimitNotice';
import { normalizeRawMessage, NormalizedMessage } from './typesRaw';
import { createReducer, reducer } from './reducer/reducer';

const CREATED_AT = Date.UTC(2026, 9, 14, 6, 59, 11);
const RESETS_AT = Date.UTC(2026, 9, 14, 7, 40) / 1000;
const NOTICE = "You've hit your session limit · resets 7:40am (UTC)";

function rateLimitEvent(id: string, status: string, createdAt = CREATED_AT) {
    return normalizeRawMessage(id, null, createdAt, {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'rate_limit_event',
                uuid: `uuid-${id}`,
                rate_limit_info: { status, resetsAt: RESETS_AT, rateLimitType: 'five_hour' },
            },
        },
    } as any);
}

function assistantText(id: string, text: string, model: string, createdAt = CREATED_AT) {
    return normalizeRawMessage(id, null, createdAt, {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                uuid: `uuid-${id}`,
                parentUuid: null,
                message: { role: 'assistant', model, content: [{ type: 'text', text }] },
            },
        },
    } as any);
}

describe('usage-limit notice text', () => {
    it('finds the reset time in both wordings seen', () => {
        expect(NOTICE.slice(limitNoticeTimeStart(NOTICE)!)).toBe('7:40am (UTC)');
        const older = "You've hit your limit · resets 6pm (UTC)";
        expect(older.slice(limitNoticeTimeStart(older)!)).toBe('6pm (UTC)');
    });

    it('ignores the notice quoted inside a longer reply', () => {
        expect(limitNoticeTimeStart(`It said:\n${NOTICE}`)).toBeNull();
    });

    it('reads the next UTC occurrence of the written time', () => {
        expect(parseLimitNoticeResetsAt(NOTICE, CREATED_AT)).toBe(RESETS_AT);
        const nextDay = "You've hit your limit · resets 6am (UTC)";
        expect(parseLimitNoticeResetsAt(nextDay, CREATED_AT)).toBe(Date.UTC(2026, 9, 15, 6) / 1000);
        expect(parseLimitNoticeResetsAt("You've hit your limit · resets 7:40am (Asia/Shanghai)", CREATED_AT)).toBeNull();
    });

    it('takes the reset time only from a rejected rate limit', () => {
        expect(rejectedLimitResetsAt({ status: 'rejected', resetsAt: RESETS_AT })).toBe(RESETS_AT);
        expect(rejectedLimitResetsAt({ status: 'allowed', resetsAt: RESETS_AT })).toBeNull();
    });
});

describe('usage-limit notice in the reducer', () => {
    it('gives a synthetic notice the reset time of the rejected rate_limit_event before it', () => {
        const event = rateLimitEvent('e1', 'rejected');
        const notice = assistantText('m1', NOTICE, '<synthetic>');
        const result = reducer(createReducer(), [event, notice] as NormalizedMessage[]);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]).toMatchObject({ kind: 'agent-text', text: NOTICE, limitEndsAt: RESETS_AT });
    });

    it('pairs them when the event comes in a later batch', () => {
        const state = createReducer();
        // Use a time the text alone cannot be read from, so the pairing is what sets it
        const text = "You've hit your session limit · resets 7:40am (Europe/Berlin)";
        expect(reducer(state, [assistantText('m1', text, '<synthetic>')] as NormalizedMessage[]).messages[0]).not.toHaveProperty('limitEndsAt');
        const result = reducer(state, [rateLimitEvent('e1', 'rejected')] as NormalizedMessage[]);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]).toMatchObject({ kind: 'agent-text', limitEndsAt: RESETS_AT });
    });

    it('falls back to the written time without an event', () => {
        const result = reducer(createReducer(), [assistantText('m1', NOTICE, '<synthetic>')] as NormalizedMessage[]);
        expect(result.messages[0]).toMatchObject({ limitEndsAt: RESETS_AT });
    });

    it('leaves the same text alone when the model wrote it', () => {
        const result = reducer(createReducer(), [assistantText('m1', NOTICE, 'claude-opus-5-5')] as NormalizedMessage[]);
        expect(result.messages[0]).not.toHaveProperty('limitEndsAt');
    });

    it('shows nothing for a rate_limit_event on its own', () => {
        expect(rateLimitEvent('e1', 'allowed')).toBeNull();
        const result = reducer(createReducer(), [rateLimitEvent('e2', 'rejected')] as NormalizedMessage[]);
        expect(result.messages).toHaveLength(0);
    });
});
