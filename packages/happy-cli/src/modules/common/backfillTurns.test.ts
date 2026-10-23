import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripAttachmentsFromPrompt } from 'happy-wire';
import { selectBackfillTurns, withForkedHistoryNotices } from './backfillTurns';
import { appendAttachmentsToPrompt } from './fileUpload';

type Item = { role: 'prompt' | 'reply' | null; id: string };
const item = (role: Item['role'], id: string): Item => ({ role, id });

describe('selectBackfillTurns', () => {
    it('keeps each prompt and the last reply of its turn', () => {
        const items = [item('reply', 'orphan'), item('prompt', 'p1'), item('reply', 'r1a'), item(null, 'tool'), item('reply', 'r1b'), item('prompt', 'p2')];
        const { selected, omittedTurns } = selectBackfillTurns(items, (i) => i.role, 20);
        expect(selected.map((i) => i.id)).toEqual(['p1', 'r1b', 'p2']);
        expect(omittedTurns).toBe(0);
    });

    it('keeps the last turns and counts the ones before them', () => {
        const items = ['1', '2', '3'].flatMap((n) => [item('prompt', `p${n}`), item('reply', `r${n}`)]);
        const { selected, omittedTurns } = selectBackfillTurns(items, (i) => i.role, 2);
        expect(selected.map((i) => i.id)).toEqual(['p2', 'r2', 'p3', 'r3']);
        expect(omittedTurns).toBe(1);
    });
});

describe('withForkedHistoryNotices', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const dataOf = (item: any) => item.content.content.data;

    it('adds nothing to a history neither copied nor cut short', () => {
        vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', '');
        vi.stubEnv('HAPPY_FORKED_FROM_TITLE', '');
        expect(withForkedHistoryNotices('claude-log:s1:', 0, ['a'])).toEqual(['a']);
    });

    it('names a source known only by its title below the history', () => {
        vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', '');
        vi.stubEnv('HAPPY_FORKED_FROM_TITLE', 'From history');
        const batch = withForkedHistoryNotices('claude-log:s1:', 0, ['a']);
        expect(batch[0]).toBe('a');
        expect(dataOf(batch[1])).toEqual({ type: 'forked-history', omittedTurns: 0, sourceTitle: 'From history' });
    });

    it('puts the turns left out above the history and the session copied from below it', () => {
        vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', 'src');
        vi.stubEnv('HAPPY_FORKED_FROM_TITLE', 'Original');
        const [above, message, below] = withForkedHistoryNotices('claude-log:s1:', 3, ['a']) as any[];
        expect(above.localId).toBe('claude-log:s1:forked-history');
        expect(above.content).toMatchObject({ role: 'agent', content: { type: 'event', data: { type: 'forked-history', omittedTurns: 3 } } });
        expect(dataOf(above)).not.toHaveProperty('sourceTitle');
        expect(message).toBe('a');
        expect(below.localId).toBe('claude-log:s1:forked-from');
        expect(dataOf(below)).toEqual({ type: 'forked-history', omittedTurns: 0, sourceSessionId: 'src', sourceTitle: 'Original' });
    });
});

describe('stripAttachmentsFromPrompt', () => {
    const attachments = [{ path: '/tmp/a.txt' }] as any;

    it('gives back the typed text', () => {
        expect(stripAttachmentsFromPrompt(appendAttachmentsToPrompt('Look at this', attachments))).toBe('Look at this');
    });

    it('keeps a prompt that was only files', () => {
        const prompt = appendAttachmentsToPrompt('', attachments);
        expect(stripAttachmentsFromPrompt(prompt)).toBe(prompt);
    });
});
