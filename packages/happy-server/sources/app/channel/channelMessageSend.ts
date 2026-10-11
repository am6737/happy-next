import { afterTx, inTx } from '@/storage/inTx';
import { ChannelMessageSendRequestSchema, TEAMMATE_TASK_ACTIVE_STATUSES, type ChannelMessageSendRequest } from 'happy-wire';
import { teammateThreadEnsure } from '@/app/teammate/teammateThreadEnsure';
import { teammateRunEnqueue } from '@/app/teammate/teammateRunEnqueue';
import { teammateTaskWake } from '@/app/teammate/teammateTaskWake';
import { teammateTaskUpdated } from '@/app/teammate/teammateTaskUpdated';
import { toTeammateTaskDto } from '@/app/teammate/teammateQueries';
import { teammateTaskHandoffNotify } from '@/app/teammate/teammateTaskHandoffNotify';
import { ChannelError } from './channelError';
import { toChannelDto, toChannelMessageDto } from './channelQueries';
import { channelMessageUpdated, channelUpdated } from './channelUpdated';
import { channelSystemMessage } from './channelSystemMessage';

type Sender = { type: 'user'; accountId: string } | { type: 'teammate'; teammateId: string; runId: string };

/** Insert once, update task decisions/replies and wake tasks atomically; route other conversations after commit. */
export async function channelMessageSend(input: { accountId: string; channelId: string; sender: Sender; req: ChannelMessageSendRequest }) {
    const { accountId, channelId, sender } = input;
    const req = ChannelMessageSendRequestSchema.parse(input.req);
    if (req.localId.startsWith('system:')) throw new ChannelError('invalid_request');
    let completion: Promise<void> | undefined;
    const message = await inTx(async tx => {
        const channel = await tx.channel.findFirst({ where: { id: channelId, accountId }, include: { members: { include: { teammate: true } } } });
        if (!channel) throw new ChannelError('not_found');
        const senderId = sender.type === 'user' ? sender.accountId : sender.teammateId;
        if (!channel.members.some(m => m.memberType === sender.type && (sender.type === 'user' ? m.accountId === senderId && senderId === accountId : m.teammateId === senderId))) throw new ChannelError('invalid_sender');
        if (sender.type === 'teammate') {
            const run = await tx.teammateRun.findFirst({ where: { id: sender.runId, teammateId: sender.teammateId, teammate: { accountId } } });
            if (!run) throw new ChannelError('invalid_sender');
        }
        const task = req.taskId ? await tx.teammateTask.findFirst({ where: { id: req.taskId, accountId } }) : null;
        const taskReply = sender.type === 'user' && channel.kind === 'dm' && !!req.taskId;
        if (taskReply && (!task || !channel.members.some(m => m.memberType === 'teammate' && m.teammateId === task.teammateId))) throw new ChannelError('invalid_request');
        if (req.taskId && !task) throw new ChannelError('not_found');
        const existing = await tx.channelMessage.findUnique({ where: { channelId_localId: { channelId, localId: req.localId } } });
        if (existing) return toChannelMessageDto(existing);
        const teammateMembers = channel.members.filter(m => m.memberType === 'teammate' && m.teammateId);
        const mentions = [...new Set(req.mentions)].filter(id => teammateMembers.some(m => m.teammateId === id));
        const updated = await tx.channel.update({ where: { id: channelId }, data: { seq: { increment: 1 } } });
        const row = await tx.channelMessage.create({ data: { channelId, seq: updated.seq, localId: req.localId, senderType: sender.type, senderId, content: req.content, kind: req.kind, mentions, taskId: req.taskId ?? null, runId: sender.type === 'teammate' ? sender.runId : null } });
        const message = toChannelMessageDto(row);
        await channelMessageUpdated(tx, accountId, message);
        if (taskReply) {
            if (task!.status === 'awaiting_input') {
                const updatedTask = await tx.teammateTask.update({ where: { id: task!.id }, data: { status: 'in_progress' } });
                await teammateTaskHandoffNotify(tx, task!, updatedTask, 'owner');
                await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(updatedTask));
            }
            await teammateTaskWake(task!.id, { type: 'channel-message', at: row.createdAt.getTime(), data: { channelId, messageId: row.id, seq: row.seq, taskId: task!.id } }, { tx });
        }
        if (sender.type === 'teammate' && req.kind === 'decision' && task) {
            const run = await tx.teammateRun.findFirst({ where: { id: sender.runId, teammateId: sender.teammateId }, include: { thread: true } });
            if (run?.thread.kind === 'task' && run.thread.taskId === task.id && (TEAMMATE_TASK_ACTIVE_STATUSES as readonly string[]).includes(task.status) && task.status !== 'awaiting_input') {
                const updatedTask = await tx.teammateTask.update({ where: { id: task.id }, data: { status: 'awaiting_input' } });
                await teammateTaskHandoffNotify(tx, task, updatedTask, 'agent');
                await teammateTaskUpdated(tx, accountId, toTeammateTaskDto(updatedTask));
            }
        }
        let guarded = false;
        if (channel.kind === 'group' && sender.type === 'teammate') {
            const lastUser = await tx.channelMessage.findFirst({ where: { channelId, senderType: 'user', senderId: { not: 'system' }, seq: { lt: row.seq } }, orderBy: { seq: 'desc' } });
            const since = lastUser?.seq ?? 0;
            const count = await tx.channelMessage.count({ where: { channelId, senderType: 'teammate', seq: { gt: since, lte: row.seq } } });
            guarded = count >= 5;
            if (guarded) await channelSystemMessage(channelId, 'loop_guard', {}, tx, `system:loop_guard:${since}`);
        }
        const targets = guarded || taskReply ? [] : teammateMembers.filter(m => m.teammate?.status !== 'archived' && m.teammateId !== senderId &&
            (channel.kind === 'dm' ? sender.type === 'user' : mentions.includes(m.teammateId!)));
        afterTx(tx, () => {
            completion = (async () => {
                // Do not let a delayed callback move lastMessageAt backwards.
                await inTx(async tx => {
                    await tx.channel.updateMany({ where: { id: channelId, lastMessageAt: { lt: row.createdAt } }, data: { lastMessageAt: row.createdAt } });
                    const current = await tx.channel.findUnique({ where: { id: channelId }, include: { members: true } });
                    if (current) await channelUpdated(tx, accountId, toChannelDto(current));
                });
                for (const target of targets) {
                    const thread = await teammateThreadEnsure(target.teammateId!, channel.kind === 'dm' ? 'dm' : 'group', { channelId });
                    await teammateRunEnqueue({ teammateId: target.teammateId!, threadId: thread.id, trigger: 'channel-message', event: { type: 'channel-message', at: row.createdAt.getTime(), data: { channelId, messageId: row.id, seq: row.seq } } });
                }
            })();
        });
        return message;
    });
    await completion;
    return message;
}
