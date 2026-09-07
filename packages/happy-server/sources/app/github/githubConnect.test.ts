import { afterEach, expect, test, vi } from 'vitest';
import { githubConnect } from './githubConnect';
import { Context } from '@/context';
import { db } from '@/storage/db';

vi.mock('@/storage/db', () => ({ db: { account: { findFirstOrThrow: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('@/modules/encrypt', () => ({ encryptString: vi.fn(() => Buffer.from('encrypted')) }));
vi.mock('@/storage/uploadImage', () => ({ uploadImage: vi.fn(async () => ({ path: 'avatar' })) }));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock('@/app/events/eventRouter', () => ({ buildUpdateAccountUpdate: vi.fn(), eventRouter: { emitUpdate: vi.fn() } }));
vi.mock('./githubDisconnect', () => ({ githubDisconnect: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test.each([undefined, { refreshToken: 'refresh-new', expiresIn: 28800 }])('reauthorization replaces credentials and refresh metadata: %j', async (meta) => {
    const start = Date.now();
    vi.mocked(db.account.findFirstOrThrow).mockResolvedValue({ githubUserId: '123', username: 'user' } as any);
    const upsert = vi.fn();
    const update = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback({
        githubUser: { upsert }, account: { update },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })));
    await githubConnect(Context.create('account'), {
        id: 123, login: 'user', name: 'User', avatar_url: 'https://example.com/avatar',
    } as any, 'gho_new', meta);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: '123' },
        update: expect.objectContaining({
            token: Buffer.from('encrypted'), refreshToken: meta ? Buffer.from('encrypted') : null,
            expiresAt: meta ? expect.any(Date) : null,
        }),
    }));
    if (meta) {
        expect(upsert.mock.calls[0][0].update.expiresAt.getTime()).toBeGreaterThanOrEqual(start + 28800_000);
        expect(upsert.mock.calls[0][0].create.expiresAt).toEqual(upsert.mock.calls[0][0].update.expiresAt);
    }
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'account' } }));
});

test('rejects GitHub App tokens before any account writes', async () => {
    await expect(githubConnect(Context.create('account'), {} as any, 'ghu_old')).rejects.toMatchObject({ status: 401 });
    expect(db.$transaction).not.toHaveBeenCalled();
});
