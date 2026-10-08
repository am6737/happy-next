import { describe, expect, it, vi } from 'vitest';
import type { AiTeamData } from './types';

const mocks = vi.hoisted(() => ({
    current: { credentials: { token: 'token-a', secret: 'account-a' } },
    fetch: vi.fn(),
}));
vi.mock('@/auth/AuthContext', () => ({ getCurrentAuth: () => mocks.current, useAuth: () => mocks.current }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://happy.example' }));
vi.mock('@/sync/apiAiTeams', () => ({ fetchAiTeamState: mocks.fetch }));
vi.mock('@/sync/aiMutationJournal', () => ({ withAiMutationIdentity: vi.fn() }));
import { getManagedAiTeamData, refreshManagedAiTeamData } from './agentStore';

describe('AI team account isolation', () => {
    it('hides old state on account switch and rejects an old account response arriving late', async () => {
        const empty: AiTeamData = { agents: [], teams: [], workItems: [], executions: [], conversations: [], messages: {} };
        const a = { ...empty, messages: { 'a-private': [] } };
        const b = { ...empty, messages: { 'b-private': [] } };
        mocks.fetch.mockResolvedValueOnce(a);
        await refreshManagedAiTeamData();
        expect(getManagedAiTeamData()).toEqual(a);

        let resolveA!: (data: AiTeamData) => void;
        mocks.fetch.mockImplementationOnce(() => new Promise<AiTeamData>((resolve) => { resolveA = resolve; }));
        const late = refreshManagedAiTeamData();
        const rejected = expect(late).rejects.toThrow('account switch');
        mocks.current.credentials = { token: 'token-b', secret: 'account-b' };
        expect(getManagedAiTeamData()).toEqual(empty);
        mocks.fetch.mockResolvedValueOnce(b);
        await refreshManagedAiTeamData();
        resolveA(a);
        await rejected;
        expect(getManagedAiTeamData()).toEqual(b);
    });
});
