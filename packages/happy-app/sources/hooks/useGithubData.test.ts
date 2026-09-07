import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import { clearGithubCache, useGithubRepo, useGithubRepos } from './useGithubData';
import { fetchGithubRepo, fetchGithubRepos } from '@/sync/apiGithubData';

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: { token: 'test' } }) }));
vi.mock('@/sync/apiGithubData', () => ({ fetchGithubRepo: vi.fn(), fetchGithubRepos: vi.fn() }));

describe('GitHub authorization state during refresh', () => {
    let root: ReturnType<typeof create> | undefined;
    beforeEach(() => {
        vi.resetAllMocks();
        clearGithubCache();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test.each(['single', 'paginated'])('%s clears expired state while rechecking authorization', async (kind) => {
        const fetcher = kind === 'single' ? vi.mocked(fetchGithubRepo) : vi.mocked(fetchGithubRepos);
        fetcher.mockRejectedValueOnce(Object.assign(new Error('Expired'), { code: 'github_token_expired' }));
        let state: ReturnType<typeof useGithubRepo> | ReturnType<typeof useGithubRepos>;
        function Harness() {
            state = kind === 'single' ? useGithubRepo('owner', 'repo') : useGithubRepos();
            return null;
        }
        await act(async () => { root = create(React.createElement(Harness)); });
        expect(state!.tokenExpired).toBe(true);
        expect(state!.loading).toBe(false);

        let resolve!: (value: any) => void;
        fetcher.mockImplementationOnce(() => new Promise<any>((done) => { resolve = done; }));
        await act(async () => { void state!.refresh(); });
        expect(state!.loading).toBe(true);
        expect(state!.tokenExpired).toBe(false);

        const result = kind === 'single' ? { fullName: 'owner/repo' } : { items: [], nextCursor: null, hasMore: false };
        await act(async () => resolve(result));
        expect(state!.loading).toBe(false);
        expect(state!.tokenExpired).toBe(false);

        fetcher.mockRejectedValueOnce(Object.assign(new Error('Still expired'), { code: 'github_token_expired' }));
        await act(async () => state!.refresh());
        expect(state!.loading).toBe(false);
        expect(state!.tokenExpired).toBe(true);
    });
});
