import { db } from '@/storage/db';
import { TeammateChannelMessageSendRequestSchema, type TeammateChannelMessageSendRequest } from 'happy-wire';
import { teammateRunAuthorize } from '@/app/teammate/teammateRunAuthorize';
import { TeammateError } from '@/app/teammate/teammateError';
import { ChannelError } from './channelError';
import { channelMessageSend } from './channelMessageSend';
import { channelTeammateDmWhere } from './channelQueries';

/** Authorize the run; task controllers report to their Agent DM with a server-owned task association. */
export async function channelTeammateMessageSend(accountId: string, input: TeammateChannelMessageSendRequest) {
    const req = TeammateChannelMessageSendRequestSchema.parse(input);
    const run = await teammateRunAuthorize(accountId, req.runId, req.dispatchToken);
    let channelId = run.thread.channelId;
    if (run.thread.kind === 'task' && run.thread.taskId) {
        const dm = await db.channel.findFirst({ where: channelTeammateDmWhere(accountId, run.teammateId) });
        if (!dm) throw new TeammateError('no_dm');
        channelId = dm.id;
        req.taskId = run.thread.taskId;
    } else if (!channelId || !['dm', 'group'].includes(run.thread.kind)) throw new ChannelError('invalid_sender');
    return channelMessageSend({ accountId, channelId: channelId!, sender: { type: 'teammate', teammateId: run.teammateId, runId: run.id }, req });
}
