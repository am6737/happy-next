import { describe, expect, it } from 'vitest';
import { LONG_USER_MESSAGE_THRESHOLD, userTextPresentation } from './messageCollapse';

const compaction = { isCompactSummary: true };
const ordinary = { sentFrom: 'user' };

function longText(extra = 1) {
    return 'x'.repeat(LONG_USER_MESSAGE_THRESHOLD + extra);
}

describe('userTextPresentation', () => {
    it('renders an ordinary message inline', () => {
        expect(userTextPresentation('hello', ordinary)).toEqual({ kind: 'markdown' });
        expect(userTextPresentation('hello')).toEqual({ kind: 'markdown' });
    });

    it('collapses a message past the length threshold', () => {
        expect(userTextPresentation(longText(), ordinary)).toEqual({
            kind: 'collapsed',
            reason: 'too-long',
            chars: LONG_USER_MESSAGE_THRESHOLD + 1,
        });
    });

    it('renders a message at the threshold inline', () => {
        expect(userTextPresentation('x'.repeat(LONG_USER_MESSAGE_THRESHOLD), ordinary)).toEqual({ kind: 'markdown' });
    });

    it('collapses a post-compaction summary however short it is', () => {
        expect(userTextPresentation('short summary', compaction)).toEqual({
            kind: 'collapsed',
            reason: 'compaction',
            chars: 13,
        });
    });

    it('reports a long summary as a summary, not as an over-long message', () => {
        expect(userTextPresentation(longText(), compaction)).toEqual({
            kind: 'collapsed',
            reason: 'compaction',
            chars: LONG_USER_MESSAGE_THRESHOLD + 1,
        });
    });

    it('reads an explicit false as an absent flag', () => {
        expect(userTextPresentation('hello', { isCompactSummary: false })).toEqual({ kind: 'markdown' });
    });

    it('measures the text it was handed, so the caller decides display-text precedence', () => {
        expect(userTextPresentation('', compaction)).toEqual({ kind: 'collapsed', reason: 'compaction', chars: 0 });
    });
});
