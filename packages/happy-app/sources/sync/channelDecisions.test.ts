import { describe, expect, it } from 'vitest';
import { latestUnansweredTaskDecision, channelDecisionSelections, channelMentionLinks } from './channelDecisions';
import type { StoredChannelMessage } from './channelReducers';
import { testChannelMessage } from './channelTestFixtures';
function message(seq: number, props: Partial<StoredChannelMessage> = {}): StoredChannelMessage {
    return { ...testChannelMessage, id: `m${seq}`, seq, localId: null, taskId: 'task', body: { text: 'yes' }, ...props };
}
const decision = message(1, { senderType: 'teammate', kind: 'decision', body: { text: 'Approve?', options: [{ id: 'yes', label: 'yes' }] } });
describe('DM reply chip', () => {
    it('selects only the latest task decision, ignoring ordinary decisions and reports', () => {
        const latest = { ...decision, id: 'latest', seq: 4, taskId: 'other' };
        expect(latestUnansweredTaskDecision([decision, message(2, { kind: 'report', senderType: 'teammate' }), latest,
            { ...decision, seq: 5, taskId: null }])).toEqual(latest);
    });
    it('treats any later typed reply to the same task as an answer', () => {
        expect(latestUnansweredTaskDecision([decision, message(2, { body: { text: 'Please use a different approach' } })])).toBeNull();
        expect(latestUnansweredTaskDecision([decision, message(2, { taskId: 'other' })])).toEqual(decision);
        expect(latestUnansweredTaskDecision([decision, message(2, { taskId: null })])).toEqual(decision);
    });
    it('ignores failed replies and hides the chip while a reply is pending', () => {
        expect(latestUnansweredTaskDecision([decision, message(0, { delivery: 'failed', createdAt: 100 })])).toEqual(decision);
        expect(latestUnansweredTaskDecision([decision, message(0, { delivery: 'pending', createdAt: 100 })])).toBeNull();
    });
    it('handles out-of-order history, earlier answers and new decisions for the same task', () => {
        const latest = { ...decision, seq: 3, id: 'new' };
        expect(latestUnansweredTaskDecision([message(2), latest, decision])).toEqual(latest);
        expect(latestUnansweredTaskDecision([message(2), decision])).toBeNull();
    });
    it('does not reactivate an older task when the newest decision is answered', () => {
        const latest = { ...decision, seq: 3, id: 'new', taskId: 'other' };
        expect(latestUnansweredTaskDecision([decision, latest, message(4, { taskId: 'other' })])).toBeNull();
        expect(latestUnansweredTaskDecision([])).toBeNull();
    });
    it('restores option choices using taskId, even when labels match in multiple decisions', () => {
        const other = { ...decision, seq: 2, id: 'other', taskId: 'other' };
        expect(channelDecisionSelections([decision, other, message(3)])).toEqual({ [decision.id]: 'yes' });
        expect(channelDecisionSelections([decision, other, message(3, { taskId: null })])).toEqual({});
    });
});

describe('channelMentionLinks', () => {
    const members = [{ id: 'a1', handle: 'alice' }];
    it('links known handles and leaves unknown ones and emails alone', () => {
        expect(channelMentionLinks('hi @alice and @bob, mail me@alice.com', members))
            .toBe('hi [@alice](mention:a1) and @bob, mail me@alice.com');
    });
});
