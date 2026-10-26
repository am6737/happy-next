import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { collectOrchestratorRunFacets, listOrchestratorRuns, listOrchestratorSessionRunFacets, mergeOrchestratorRunFacets } from './apiOrchestrator';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://happy.example',
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/utils/time', () => ({
    backoff: async <T>(callback: () => Promise<T>) => callback(),
}));

const credentials: AuthCredentials = {
    token: 'token-1',
    secret: 'secret-1',
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('listOrchestratorRuns', () => {
    it('includes controllerSessionId query when provided', async () => {
        let requestUrl: string | null = null;
        const fetchMock = vi.fn(async (input: unknown) => {
            requestUrl = String(input);
            return {
                ok: true,
                json: async () => ({
                    ok: true,
                    data: {
                        items: [],
                    },
                }),
            };
        });
        vi.stubGlobal('fetch', fetchMock);

        await listOrchestratorRuns(credentials, {} as never, {
            status: 'active',
            limit: 20,
            cursor: 'cursor-1',
            controllerSessionId: 'session-123',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestUrl).not.toBeNull();
        const parsed = new URL(requestUrl!);
        expect(parsed.pathname).toBe('/v1/orchestrator/runs');
        expect(parsed.searchParams.get('controllerSessionId')).toBe('session-123');
        expect(parsed.searchParams.get('status')).toBe('active');
        expect(parsed.searchParams.get('limit')).toBe('20');
        expect(parsed.searchParams.get('cursor')).toBe('cursor-1');
    });
});

describe('orchestrator run facets', () => {
    it('collects the machines and kinds the runs used', () => {
        const facets = collectOrchestratorRunFacets([
            { machines: ['m1', 'm2'], providers: ['claude', 'shell'] },
            { machines: ['m2'], providers: ['codex'] },
            { machines: [], providers: ['transfer'] },
        ]);
        expect(facets.machineIds).toEqual(['m1', 'm2']);
        expect(facets.kinds).toEqual(['agent', 'shell', 'transfer']);
    });

    it('keeps the first facets when the second adds nothing', () => {
        const a = { machineIds: ['m1'], kinds: ['agent' as const] };
        expect(mergeOrchestratorRunFacets(a, { machineIds: ['m1'], kinds: [] })).toBe(a);
        expect(mergeOrchestratorRunFacets(a, { machineIds: ['m2'], kinds: ['shell'] })).toEqual({ machineIds: ['m1', 'm2'], kinds: ['agent', 'shell'] });
    });

    it('scans every page of the conversation\'s runs with no other filter', async () => {
        const urls: URL[] = [];
        const pages = [
            { items: [{ machines: ['m1'], providers: ['claude'] }], nextCursor: 'c1' },
            { items: [{ machines: ['m2'], providers: ['shell'] }] },
        ];
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            urls.push(new URL(String(input)));
            const data = pages[urls.length - 1];
            return { ok: true, json: async () => ({ ok: true, data }) };
        }));

        const facets = await listOrchestratorSessionRunFacets(credentials, 'session-123');

        expect(facets).toEqual({ machineIds: ['m1', 'm2'], kinds: ['agent', 'shell'] });
        expect(urls).toHaveLength(2);
        expect(urls[0].searchParams.get('controllerSessionId')).toBe('session-123');
        expect(urls[0].searchParams.has('status')).toBe(false);
        expect(urls[0].searchParams.has('kind')).toBe(false);
        expect(urls[0].searchParams.has('machineId')).toBe(false);
        expect(urls[1].searchParams.get('cursor')).toBe('c1');
    });
});
