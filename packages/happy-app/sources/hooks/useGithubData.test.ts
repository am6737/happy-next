import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
// @ts-expect-error react-test-renderer does not ship types in this workspace.
import { create } from 'react-test-renderer';
import { clearGithubCache, useGithubRepo, useGithubRepos } from './useGithubData';
import { fetchGithubRepo, fetchGithubRepos } from '@/sync/apiGithubData';

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: { token: 'test' } }) }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
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

    test('old filter responses cannot overwrite the current repository search', async () => {
        let resolveOld!: (value: any) => void;
        vi.mocked(fetchGithubRepos).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
        vi.mocked(fetchGithubRepos).mockResolvedValueOnce({ items: [{ fullName: 'org/new' }], hasMore: false, nextCursor: null } as any);
        let state: ReturnType<typeof useGithubRepos>;
        function Harness({ search }: { search: string }) { state = useGithubRepos({ search }); return null; }
        await act(async () => { root = create(React.createElement(Harness, { search: 'old' })); });
        await act(async () => root.update(React.createElement(Harness, { search: 'new' })));
        await act(async () => resolveOld({ items: [{ fullName: 'org/old' }], hasMore: true, nextCursor: 'old-next' }));
        expect(state!.data).toEqual([{ fullName: 'org/new' }]);
        expect(state!.hasMore).toBe(false);
    });

    test('refresh prevents a stale load-more response from appending to the new first page', async () => {
        vi.mocked(fetchGithubRepos).mockResolvedValueOnce({ items: [{ fullName: 'org/one' }], hasMore: true, nextCursor: 'next' } as any);
        let resolveMore!: (value: any) => void;
        vi.mocked(fetchGithubRepos).mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }));
        vi.mocked(fetchGithubRepos).mockResolvedValueOnce({ items: [{ fullName: 'org/fresh' }], hasMore: false, nextCursor: null } as any);
        let state: ReturnType<typeof useGithubRepos>;
        function Harness() { state = useGithubRepos(); return null; }
        await act(async () => { root = create(React.createElement(Harness)); });
        await act(async () => state!.loadMore());
        await act(async () => state!.refresh());
        await act(async () => resolveMore({ items: [{ fullName: 'org/old-page' }], hasMore: false, nextCursor: null }));
        expect(state!.data).toEqual([{ fullName: 'org/fresh' }]);
        expect(state!.loadingMore).toBe(false);
    });

    test('forced refresh cannot be overwritten by an older shared request', async () => {
        let resolveOld!: (value: any) => void;
        vi.mocked(fetchGithubRepos).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
        vi.mocked(fetchGithubRepos).mockResolvedValueOnce({ items: [{ fullName: 'org/fresh' }], hasMore: false, nextCursor: null } as any);
        let first!: ReturnType<typeof useGithubRepos>;
        let second!: ReturnType<typeof useGithubRepos>;
        function Harness() {
            first = useGithubRepos();
            second = useGithubRepos();
            return null;
        }

        await act(async () => { root = create(React.createElement(Harness)); });
        await act(async () => { void second.refresh(); });
        await act(async () => resolveOld({ items: [{ fullName: 'org/old' }], hasMore: false, nextCursor: null }));
        expect(second!.data).toEqual([{ fullName: 'org/fresh' }]);

        let mounted!: ReturnType<typeof useGithubRepos>;
        function LaterHarness() { mounted = useGithubRepos(); return null; }
        await act(async () => root!.update(React.createElement(LaterHarness)));
        expect(mounted!.data).toEqual([{ fullName: 'org/fresh' }]);
    });
});
