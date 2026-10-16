import { afterEach, describe, expect, it, vi } from 'vitest';
import { forkedHistoryNotice, isInjectedPrompt, selectBackfillTurns } from './backfillTurns';
import { appendAttachmentsToPrompt, stripAttachmentsFromPrompt } from './fileUpload';

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

describe('isInjectedPrompt', () => {
    it('recognizes callbacks and task notifications, not prompts that mention them', () => {
        expect(isInjectedPrompt('<orchestrator-callback>\nRun "x" reached terminal state: completed.\n</orchestrator-callback>')).toBe(true);
        expect(isInjectedPrompt('<task-notification>done</task-notification>')).toBe(true);
        expect(isInjectedPrompt('Why does <orchestrator-callback> show up?')).toBe(false);
    });
});

describe('forkedHistoryNotice', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is none for a history neither copied nor cut short', () => {
        vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', '');
        vi.stubEnv('HAPPY_FORKED_FROM_TITLE', '');
        expect(forkedHistoryNotice('claude-log:s1:', 0)).toBeNull();
    });

    it('names a source known only by its title', () => {
        vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', '');
        vi.stubEnv('HAPPY_FORKED_FROM_TITLE', 'From history');
        const data = (forkedHistoryNotice('claude-log:s1:', 0)?.content as any).content.data;
        expect(data).toEqual({ type: 'forked-history', omittedTurns: 0, sourceTitle: 'From history' });
    });

    it('names the session copied from and the turns left out', () => {
        vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', 'src');
        vi.stubEnv('HAPPY_FORKED_FROM_TITLE', 'Original');
        const notice = forkedHistoryNotice('claude-log:s1:', 3);
        expect(notice?.localId).toBe('claude-log:s1:forked-history');
        expect(notice?.content).toMatchObject({
            role: 'agent',
            content: { type: 'event', data: { type: 'forked-history', omittedTurns: 3, sourceSessionId: 'src', sourceTitle: 'Original' } },
        });
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
