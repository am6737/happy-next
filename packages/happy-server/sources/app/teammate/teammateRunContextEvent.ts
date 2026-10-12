import type { TeammateContextEventRequest } from 'happy-wire';
import { inTx } from '@/storage/inTx';
import { channelSystemMessage } from '@/app/channel/channelSystemMessage';
import { teammateRunAuthorize } from './teammateRunAuthorize';
import { teammateRunTerminateTx } from './teammateRunFinish';
import { TEAMMATE_ACTIVE_RUN_STATUSES } from './teammateRunStatuses';

/**
 * Context signals reported by the Agent's controller session. Compaction and a failed resume only post a
 * channel notice. An overflow fails the run (also after turn-end completed it) with the retryable
 * `context_overflow` reason, so the existing retry re-runs it on a fresh provider session; the notice is
 * posted only when that retry exists, otherwise the generic run_failed notice explains it.
 * Idempotent: notices are keyed by run, and the conditional transition retries at most once.
 */
export async function teammateRunContextEvent(runId: string, body: TeammateContextEventRequest, accountId: string): Promise<void> {
    await inTx(async (tx) => {
        const run = await teammateRunAuthorize(accountId, runId, body.dispatchToken, tx);
        const base = { teammateId: run.teammateId, name: run.teammate.name, provider: body.provider };
        if (body.code === 'context_compacted') {
            if (!run.thread.channelId) return;
            await channelSystemMessage(run.thread.channelId, 'context_compacted', { ...base, compactions: body.compactions }, tx, `system:context_compacted:${runId}:${body.compactions}`);
            return;
        }
        if (body.reason === 'resume_failed') {
            if (!run.thread.channelId) return;
            await channelSystemMessage(run.thread.channelId, 'context_lost', { ...base, reason: body.reason }, tx, `system:context_lost:${runId}`);
            return;
        }
        if (![...TEAMMATE_ACTIVE_RUN_STATUSES, 'completed'].includes(run.status)) return;
        const terminated = await teammateRunTerminateTx(tx, runId, 'failed', 'context_overflow', new Date(), {}, { allowCompleted: true });
        if (terminated && run.attempt < 2 && run.thread.channelId) {
            await channelSystemMessage(run.thread.channelId, 'context_lost', { ...base, reason: body.reason }, tx, `system:context_lost:${runId}`);
        }
    });
}
