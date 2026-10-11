import { db } from '@/storage/db';
import type { Tx } from '@/storage/inTx';
import { TeammateError } from './teammateError';

/** Authenticate callbacks even on terminal runs; foreign runs are never disclosed. */
export async function teammateRunAuthenticate(tx: Tx, runId: string, accountId: string, dispatchToken: string) {
    const run = await tx.teammateRun.findFirst({ where: { id: runId, teammate: { accountId } }, include: { teammate: true, thread: true } });
    if (!run) throw new TeammateError('not_found');
    if (run.dispatchToken !== dispatchToken) throw new TeammateError('invalid_token');
    return run;
}

/** Scope daemon requests to their account and token; terminal callbacks expire at one hour. */
export async function teammateRunAuthorize(accountId: string, runId: string, dispatchToken: string, tx?: Tx) {
    const run = await teammateRunAuthenticate(tx ?? db, runId, accountId, dispatchToken);
    if (['completed', 'failed', 'cancelled'].includes(run.status) && (!run.finishedAt || run.finishedAt.getTime() <= Date.now() - 60 * 60_000)) throw new TeammateError('run_expired');
    return run;
}
