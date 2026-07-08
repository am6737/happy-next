import { describe, expect, it } from 'vitest';
import type { ApiMessage } from '../apiTypes';
import { InMemoryMessageRepository } from './messageRepository.memory';

function msg(seq: number, overrides: Partial<ApiMessage> = {}): ApiMessage {
    return {
        id: `m${seq}`,
        seq,
        localId: `l${seq}`,
        content: { t: 'encrypted', c: `cipher-${seq}` },
        createdAt: 1000 + seq,
        updatedAt: 2000 + seq,
        sentBy: null,
        sentByName: null,
        ...overrides,
    };
}

describe('message repository contract', () => {
    it('stores encrypted messages and returns latest/before/after pages in API order', async () => {
        const repo = new InMemoryMessageRepository();
        await repo.upsertMessages('account', 's1', [msg(1), msg(2), msg(3), msg(4)]);

        const latest = await repo.getLatestMessages('account', 's1', 2);
        expect(latest.messages.map((m) => m.seq)).toEqual([4, 3]);
        expect(latest.minSeq).toBe(3);
        expect(latest.maxSeq).toBe(4);
        expect(latest.hasMoreLocal).toBe(true);

        const after = await repo.getMessagesAfter('account', 's1', 2, 10);
        expect(after.messages.map((m) => m.seq)).toEqual([3, 4]);
        expect(after.hasMoreLocal).toBe(false);

        const before = await repo.getMessagesBefore('account', 's1', 4, 2);
        expect(before.messages.map((m) => m.seq)).toEqual([3, 2]);
        expect(before.hasMoreLocal).toBe(true);
    });

    it('replaces stale rows on seq conflict', async () => {
        const repo = new InMemoryMessageRepository();
        await repo.upsertMessages('account', 's1', [msg(1, { id: 'old' })]);
        await repo.upsertMessages('account', 's1', [msg(1, { id: 'new', content: { t: 'encrypted', c: 'new-cipher' } })]);

        const latest = await repo.getLatestMessages('account', 's1', 10);
        expect(latest.messages).toHaveLength(1);
        expect(latest.messages[0].id).toBe('new');
        expect(latest.messages[0].content.c).toBe('new-cipher');
    });

    it('persists delivery issue updates and session sync state', async () => {
        const repo = new InMemoryMessageRepository();
        await repo.upsertMessages('account', 's1', [msg(1, { id: 'server-id', localId: 'local-id' })]);

        await repo.updateDeliveryIssue('account', 's1', { localId: 'local-id' }, { status: 'error', reason: 'no_cli_connection' });
        const latest = await repo.getLatestMessages('account', 's1', 10);
        expect(latest.messages[0].deliveryIssue).toEqual({ status: 'error', reason: 'no_cli_connection' });

        await repo.updateSessionState('account', 's1', { forwardMaxSeq: 1, oldestLoadedSeq: 1, hasMoreOlder: false });
        expect(await repo.getSessionState('account', 's1')).toMatchObject({
            forwardMaxSeq: 1,
            oldestLoadedSeq: 1,
            hasMoreOlder: false,
        });

        await repo.clearSession('account', 's1');
        expect((await repo.getLatestMessages('account', 's1', 10)).messages).toEqual([]);
        expect(await repo.getSessionState('account', 's1')).toBeNull();
    });

    it('applies pending delivery issue updates that arrive before the message row', async () => {
        const repo = new InMemoryMessageRepository();

        await repo.updateDeliveryIssue(
            'account',
            's1',
            { messageId: 'server-id', localId: 'local-id' },
            { status: 'error', reason: 'no_cli_connection' },
        );
        await repo.upsertMessages('account', 's1', [msg(1, { id: 'server-id', localId: 'local-id' })]);

        const latest = await repo.getLatestMessages('account', 's1', 10);
        expect(latest.messages[0].deliveryIssue).toEqual({ status: 'error', reason: 'no_cli_connection' });
    });

    it('can upsert messages and coverage state atomically via the repository contract', async () => {
        const repo = new InMemoryMessageRepository();

        await repo.upsertMessagesAndUpdateState('account', 's1', [msg(1), msg(2)], {
            forwardMaxSeq: 2,
            oldestLoadedSeq: 1,
            hasMoreOlder: false,
            contiguousMinSeq: 1,
            contiguousMaxSeq: 2,
            remoteOldestSeq: 1,
        });

        expect((await repo.getLatestMessages('account', 's1', 10)).messages.map((message) => message.seq)).toEqual([2, 1]);
        expect(await repo.getSessionState('account', 's1')).toMatchObject({
            contiguousMinSeq: 1,
            contiguousMaxSeq: 2,
            remoteOldestSeq: 1,
            hasMoreOlder: false,
        });
    });
});
