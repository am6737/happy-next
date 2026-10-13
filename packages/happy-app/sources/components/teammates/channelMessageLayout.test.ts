import { describe, expect, it } from 'vitest';
import type { StoredChannelMessage } from '@/sync/channelReducers';
import { channelGithubReference, channelLinkSource, channelRowLayouts, channelTime, githubLinkState } from './channelMessageLayout';

const at = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();

function message(id: string, sender: string, createdAt: number, system = false): StoredChannelMessage {
    return {
        id, channelId: 'c', seq: 1, localId: null, senderType: sender === 'me' ? 'user' : 'teammate', senderId: sender,
        content: system ? { t: 'system', code: 'context_reset', data: {} } : { t: 'encrypted', c: '' },
        mentions: [], kind: 'text', taskId: null, runId: null, createdAt,
    };
}

describe('channelRowLayouts', () => {
    const now = at(2026, 10, 9, 12);

    it('starts a day with a date pill and drops the year for the current year', () => {
        const layouts = channelRowLayouts([
            message('a', 'atlas', at(2025, 12, 31)),
            message('b', 'atlas', at(2026, 10, 8)),
            message('c', 'atlas', at(2026, 10, 8, 10)),
        ], now);
        expect(layouts.map(layout => layout.date)).toEqual(['2025-12-31', '10-08', null]);
    });

    it('shows a header only where a sender run starts', () => {
        const layouts = channelRowLayouts([
            message('a', 'atlas', at(2026, 10, 9, 9)),
            message('b', 'atlas', at(2026, 10, 9, 9, 5)),
            message('c', 'me', at(2026, 10, 9, 10)),
            message('d', 'nova', at(2026, 10, 9, 11)),
        ], now);
        expect(layouts.map(layout => [layout.header, layout.continued])).toEqual([[true, false], [false, true], [true, false], [true, false]]);
    });

    it('breaks a run at system notices and day changes', () => {
        const layouts = channelRowLayouts([
            message('a', 'atlas', at(2026, 10, 8)),
            message('b', 'atlas', at(2026, 10, 9)),
            message('c', 'system', at(2026, 10, 9), true),
            message('d', 'atlas', at(2026, 10, 9)),
        ], now);
        expect(layouts.map(layout => [layout.header, layout.continued])).toEqual([[true, false], [true, false], [false, false], [true, false]]);
    });

    it('breaks a run when the same sender writes again more than five minutes later', () => {
        const layouts = channelRowLayouts([
            message('a', 'lead', at(2026, 10, 9, 2, 35)),
            message('b', 'lead', at(2026, 10, 9, 2, 40)),
            message('c', 'lead', at(2026, 10, 9, 15, 58)),
        ], now);
        expect(layouts.map(layout => [layout.header, layout.continued])).toEqual([[true, false], [false, true], [true, false]]);
    });
});

describe('channelTime', () => {
    it('formats as HH:mm', () => {
        expect(channelTime(new Date(2026, 0, 1, 7, 5).getTime())).toBe('07:05');
    });
});

describe('channelLinkSource', () => {
    it('names the repository and number of GitHub PRs and issues', () => {
        expect(channelLinkSource({ kind: 'pr', url: 'https://github.com/am6737/happy-next/pull/21' })).toEqual({ source: 'am6737/happy-next', number: '#21' });
        expect(channelLinkSource({ kind: 'issue', url: 'https://github.com/am6737/happy-next/issues/20#issuecomment-1' })).toEqual({ source: 'am6737/happy-next', number: '#20' });
    });

    it('falls back to the host, and names nothing for sessions', () => {
        expect(channelLinkSource({ kind: 'url', url: 'https://user@docs.example.com:8443/a?b' })).toEqual({ source: 'docs.example.com', number: null });
        expect(channelLinkSource({ kind: 'pr', url: 'https://gitlab.com/a/b/-/merge_requests/3' })).toEqual({ source: 'gitlab.com', number: null });
        expect(channelLinkSource({ kind: 'session', url: 'https://example.com' })).toEqual({ source: null, number: null });
        expect(channelLinkSource({ kind: 'url' })).toEqual({ source: null, number: null });
    });
});

describe('channelGithubReference', () => {
    it('reads the owner, repository and number of GitHub PRs and issues only', () => {
        expect(channelGithubReference({ kind: 'pr', url: 'https://github.com/am6737/happy-next/pull/21/files' })).toEqual({ owner: 'am6737', repo: 'happy-next', number: 21 });
        expect(channelGithubReference({ kind: 'url', url: 'https://github.com/am6737/happy-next/pull/21' })).toBeNull();
        expect(channelGithubReference({ kind: 'issue' })).toBeNull();
    });
});

describe('githubLinkState', () => {
    it('tells drafts from open PRs and merged from closed ones', () => {
        expect(githubLinkState({ status: 'open', isDraft: true })).toBe('draft');
        expect(githubLinkState({ status: 'open' })).toBe('open');
        expect(githubLinkState({ status: 'merged', isDraft: true })).toBe('merged');
        expect(githubLinkState({ status: 'closed' })).toBe('closed');
    });

    it('tells issues closed as not planned from completed ones', () => {
        expect(githubLinkState({ state: 'closed', stateReason: 'completed' })).toBe('closed');
        expect(githubLinkState({ state: 'closed', stateReason: 'not_planned' })).toBe('notPlanned');
        expect(githubLinkState({ state: 'closed', stateReason: 'duplicate' })).toBe('notPlanned');
        expect(githubLinkState({ state: 'open' })).toBe('open');
        expect(githubLinkState(null)).toBeNull();
    });
});
