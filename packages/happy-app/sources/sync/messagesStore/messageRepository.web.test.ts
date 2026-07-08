import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiMessage } from '../apiTypes';
import { messageRepository } from './messageRepository';

function msg(seq: number, overrides: Partial<ApiMessage> = {}): ApiMessage {
    return {
        id: `web-m${seq}`,
        seq,
        localId: `web-l${seq}`,
        content: { t: 'encrypted', c: `web-cipher-${seq}` },
        createdAt: 3000 + seq,
        updatedAt: 4000 + seq,
        sentBy: null,
        sentByName: null,
        ...overrides,
    };
}

describe('IndexedDB message repository', () => {
    beforeEach(async () => {
        await messageRepository.clearAll();
    });

    it('persists messages, state, delivery updates and account clearing', async () => {
        await messageRepository.upsertMessages('web-account', 's1', [msg(1), msg(2), msg(3)]);
        await messageRepository.updateSessionState('web-account', 's1', {
            forwardMaxSeq: 3,
            oldestLoadedSeq: 1,
            hasMoreOlder: false,
        });

        const latest = await messageRepository.getLatestMessages('web-account', 's1', 2);
        expect(latest.messages.map((m) => m.seq)).toEqual([3, 2]);
        expect(latest.hasMoreLocal).toBe(true);

        const after = await messageRepository.getMessagesAfter('web-account', 's1', 1, 10);
        expect(after.messages.map((m) => m.seq)).toEqual([2, 3]);

        await messageRepository.updateDeliveryIssue('web-account', 's1', { messageId: 'web-m2' }, { status: 'error', reason: 'failed' });
        const before = await messageRepository.getMessagesBefore('web-account', 's1', 3, 10);
        expect(before.messages.find((m) => m.id === 'web-m2')?.deliveryIssue).toEqual({ status: 'error', reason: 'failed' });

        expect(await messageRepository.getSessionState('web-account', 's1')).toMatchObject({
            forwardMaxSeq: 3,
            oldestLoadedSeq: 1,
            hasMoreOlder: false,
        });

        await messageRepository.clearAccount('web-account');
        expect((await messageRepository.getLatestMessages('web-account', 's1', 10)).messages).toEqual([]);
        expect(await messageRepository.getSessionState('web-account', 's1')).toBeNull();
    });

    it('replaces old message when another row reuses the same session seq', async () => {
        await messageRepository.upsertMessages('web-account', 's1', [msg(1, { id: 'old-web-id' })]);
        await messageRepository.upsertMessages('web-account', 's1', [msg(1, { id: 'new-web-id' })]);

        const latest = await messageRepository.getLatestMessages('web-account', 's1', 10);
        expect(latest.messages.map((m) => m.id)).toEqual(['new-web-id']);
    });

    it('applies pending delivery issue updates that arrive before the message row', async () => {
        await messageRepository.updateDeliveryIssue(
            'web-account',
            's1',
            { messageId: 'web-server-id', localId: 'web-local-id' },
            { status: 'error', reason: 'no_cli_connection' },
        );
        await messageRepository.upsertMessages('web-account', 's1', [msg(1, { id: 'web-server-id', localId: 'web-local-id' })]);

        const latest = await messageRepository.getLatestMessages('web-account', 's1', 10);
        expect(latest.messages[0].deliveryIssue).toEqual({ status: 'error', reason: 'no_cli_connection' });
    });

    it('upserts messages and coverage state in one write transaction', async () => {
        await messageRepository.upsertMessagesAndUpdateState('web-account', 's1', [msg(1), msg(2)], {
            forwardMaxSeq: 2,
            oldestLoadedSeq: 1,
            hasMoreOlder: false,
            contiguousMinSeq: 1,
            contiguousMaxSeq: 2,
            remoteOldestSeq: 1,
        });

        expect((await messageRepository.getLatestMessages('web-account', 's1', 10)).messages.map((message) => message.seq)).toEqual([2, 1]);
        expect(await messageRepository.getSessionState('web-account', 's1')).toMatchObject({
            contiguousMinSeq: 1,
            contiguousMaxSeq: 2,
            remoteOldestSeq: 1,
            hasMoreOlder: false,
        });
    });
});
