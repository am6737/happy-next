import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@/context';

const mocks = vi.hoisted(() => ({
    accountFind: vi.fn(), grantDelete: vi.fn(), accountUpdate: vi.fn(), githubDelete: vi.fn(),
    txGrantDelete: vi.fn(), emit: vi.fn(),
}));
vi.mock('@/storage/db', () => ({ db: {
    account: { findUnique: mocks.accountFind },
    aiGithubRepositoryGrant: { deleteMany: mocks.grantDelete },
    $transaction: vi.fn(async (callback: any) => callback({
        account: { update: mocks.accountUpdate }, githubUser: { delete: mocks.githubDelete },
        aiGithubRepositoryGrant: { deleteMany: mocks.txGrantDelete },
    })),
} }));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock('@/app/events/eventRouter', () => ({
    buildUpdateAccountUpdate: vi.fn(() => ({})), eventRouter: { emitUpdate: mocks.emit },
}));

import { githubDisconnect } from './githubDisconnect';

describe('GitHub grant cleanup', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('removes stale grants even when the OAuth link is already gone', async () => {
        mocks.accountFind.mockResolvedValue({ githubUserId: null });
        await githubDisconnect(Context.create('account'));
        expect(mocks.grantDelete).toHaveBeenCalledWith({ where: { accountId: 'account' } });
    });

    it('removes grants in the same transaction as token deletion', async () => {
        mocks.accountFind.mockResolvedValue({ githubUserId: 'github-user' });
        await githubDisconnect(Context.create('account'));
        expect(mocks.txGrantDelete).toHaveBeenCalledWith({ where: { accountId: 'account' } });
        expect(mocks.githubDelete).toHaveBeenCalledWith({ where: { id: 'github-user' } });
    });
});
