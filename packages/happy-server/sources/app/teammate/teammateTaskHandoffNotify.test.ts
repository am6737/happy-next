import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueue, ensure } = vi.hoisted(() => ({ enqueue: vi.fn(), ensure: vi.fn() }));
vi.mock('./teammateRunEnqueue', () => ({ teammateRunEnqueue: enqueue }));
vi.mock('./teammateThreadEnsure', () => ({ teammateThreadEnsure: ensure }));

import { teammateTaskHandoffNotify } from './teammateTaskHandoffNotify';
import { TeammateError } from './teammateError';

const before = {
    id: 'task', accountId: 'account', teammateId: 'builder', createdByTeammateId: 'lead', createdByThreadId: 'creator-thread',
    source: 'github-issue', resourceId: 'owner/repo#7', title: 'Review change', url: 'https://github.com/owner/repo/issues/7',
    status: 'in_progress', summary: null, prUrl: null, createdAt: new Date(), updatedAt: new Date(),
} as any;
const tx = {
    teammate: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
    },
    teammateThread: { findFirst: vi.fn() },
    channel: { findFirst: vi.fn() },
} as any;

beforeEach(() => {
    vi.clearAllMocks();
    tx.teammate.findFirst.mockResolvedValue({ id: 'lead', status: 'active' });
    tx.teammate.findUnique.mockResolvedValue({ name: 'Builder' });
    tx.teammateThread.findFirst.mockResolvedValue({ id: 'creator-thread', teammateId: 'lead', kind: 'dm', channelId: 'dm' });
    tx.channel.findFirst.mockResolvedValue({ id: 'dm' });
    ensure.mockResolvedValue({ id: 'creator-dm', teammateId: 'lead', kind: 'dm', channelId: 'dm' });
    enqueue.mockResolvedValue(undefined);
});

describe('teammateTaskHandoffNotify', () => {
    it.each(['in_review', 'done', 'awaiting_input'] as const)('enqueues a creator update for %s', async status => {
        const after = { ...before, status, summary: 'Ready', prUrl: 'https://github.com/owner/repo/pull/7' };
        await teammateTaskHandoffNotify(tx, before, after, 'agent');
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ teammateId: 'lead', threadId: 'creator-thread', trigger: 'task-update', event: expect.objectContaining({ type: 'task-update', data: expect.objectContaining({ taskId: 'task', from: 'in_progress', to: status, summary: 'Ready', prUrl: after.prUrl, assigneeId: 'builder', assigneeName: 'Builder', by: 'agent' }) }) }), tx);
    });

    it.each([
        ['in_progress', 'status'],
        ['in_review', 'self'],
        ['in_review', 'no creator'],
    ] as const)('does not wake for %s (%s)', async (status, reason) => {
        const after = { ...before, status, ...(reason === 'self' ? { teammateId: 'lead' } : {}), ...(reason === 'no creator' ? { createdByTeammateId: null } : {}) };
        await teammateTaskHandoffNotify(tx, before, after, 'agent');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('falls back to the creator DM when the recorded thread is a heartbeat/task thread', async () => {
        tx.teammateThread.findFirst.mockResolvedValue(null);
        await teammateTaskHandoffNotify(tx, before, { ...before, status: 'done' }, 'agent');
        expect(ensure).toHaveBeenCalledWith('lead', 'dm', { channelId: 'dm' }, tx);
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'creator-dm' }), tx);
    });

    it('skips missing creators and missing DMs without throwing', async () => {
        tx.teammate.findFirst.mockResolvedValueOnce(null);
        await expect(teammateTaskHandoffNotify(tx, before, { ...before, status: 'done' }, 'system')).resolves.toBeUndefined();
        tx.teammate.findFirst.mockResolvedValueOnce({ id: 'lead', status: 'active' });
        tx.teammateThread.findFirst.mockResolvedValueOnce(null);
        tx.channel.findFirst.mockResolvedValueOnce(null);
        await expect(teammateTaskHandoffNotify(tx, before, { ...before, status: 'cancelled' }, 'owner')).resolves.toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('ignores invalidated targets but propagates database errors so the transaction can retry', async () => {
        enqueue.mockRejectedValueOnce(new TeammateError('archived'));
        await expect(teammateTaskHandoffNotify(tx, before, { ...before, status: 'done' }, 'agent')).resolves.toBeUndefined();
        const conflict = new Error('P2034 write conflict');
        enqueue.mockRejectedValueOnce(conflict);
        await expect(teammateTaskHandoffNotify(tx, before, { ...before, status: 'done' }, 'agent')).rejects.toBe(conflict);
    });
});
