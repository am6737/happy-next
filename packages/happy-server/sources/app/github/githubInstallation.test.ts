import { describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('./githubApi', () => ({ getUserOctokit: vi.fn(async () => ({ request })) }));
import { findAuthorizedInstallation } from './githubInstallation';

describe('trusted GitHub installation binding', () => {
    it('binds only a repository returned by the account installation API', async () => {
        request.mockImplementation(async (path: string) => path === 'GET /user/installations'
            ? { data: { installations: [{ id: 9 }] } }
            : { data: { repositories: [{ id: 42 }] } });
        expect(await findAuthorizedInstallation('account', 42n)).toBe(9n);
        expect(await findAuthorizedInstallation('account', 99n)).toBeNull();
    });

    it('fails closed when installation access is unavailable', async () => {
        request.mockRejectedValue(new Error('403'));
        expect(await findAuthorizedInstallation('account', 42n)).toBeNull();
    });
});
