import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    deletePending: vi.fn(),
    createMessage: vi.fn(),
    commitAttachmentLeases: vi.fn(),
    allocateSessionSeqBatch: vi.fn(),
    emitToSessionSubscribers: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: {
        $transaction: mocks.transaction,
        sessionMessageDeliveryIssue: { upsert: vi.fn() },
    },
}));

vi.mock('@/app/chat/chatAttachmentLease', () => ({
    commitAttachmentLeases: mocks.commitAttachmentLeases,
}));

vi.mock('@/storage/seq', () => ({
    allocateSessionSeqBatch: mocks.allocateSessionSeqBatch,
}));

vi.mock('@/app/events/eventRouter', () => ({
    buildMessageDeliveryErrorEphemeral: vi.fn(),
    buildNewMessageUpdate: vi.fn(),
    eventRouter: {
        getConnections: vi.fn(() => undefined),
        emitToSessionSubscribers: mocks.emitToSessionSubscribers,
        emitEphemeralToSessionSubscribers: vi.fn(),
    },
}));

vi.mock('@/utils/randomKeyNaked', () => ({ randomKeyNaked: vi.fn(() => 'random') }));

import { dispatchSessionMessage } from './sessionMessageDispatch';

const params = {
    ownerId: 'owner-1',
    sessionId: 'session-1',
    content: 'ciphertext',
    localId: 'local-1',
    sentBy: 'owner-1',
    sentByName: null,
    trackCliDelivery: false,
    pendingMessageId: 'pending-1',
};

describe('dispatchSessionMessage pending messages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const tx = {
            sessionPendingMessage: { deleteMany: mocks.deletePending },
            sessionMessage: { create: mocks.createMessage },
            sessionMessageDeliveryIssue: { create: vi.fn() },
        };
        mocks.transaction.mockImplementation((callback) => callback(tx));
        mocks.deletePending.mockResolvedValue({ count: 1 });
        mocks.commitAttachmentLeases.mockResolvedValue(undefined);
        mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
        mocks.createMessage.mockResolvedValue({
            id: 'message-1',
            seq: 1,
            localId: 'local-1',
            sentBy: 'owner-1',
            sentByName: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        mocks.emitToSessionSubscribers.mockResolvedValue({
            ownerDelivery: { sessionScoped: 1 },
        });
    });

    it('deletes the pending row in the message creation transaction', async () => {
        await expect(dispatchSessionMessage(params)).resolves.toMatchObject({
            message: { id: 'message-1' },
        });

        expect(mocks.deletePending).toHaveBeenCalledWith({
            where: {
                id: 'pending-1',
                sessionId: 'session-1',
                localId: 'local-1',
            },
        });
        expect(mocks.createMessage).toHaveBeenCalledTimes(1);
    });

    it('does not create a message if another dispatcher claimed the pending row', async () => {
        mocks.deletePending.mockResolvedValueOnce({ count: 0 });

        await expect(dispatchSessionMessage(params)).rejects.toThrow(
            'Pending message is no longer available for dispatch',
        );
        expect(mocks.commitAttachmentLeases).not.toHaveBeenCalled();
        expect(mocks.createMessage).not.toHaveBeenCalled();
    });
});
