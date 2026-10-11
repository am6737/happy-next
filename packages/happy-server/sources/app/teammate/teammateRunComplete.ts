import { inTx } from '@/storage/inTx';
import { teammateRunTerminateTx } from './teammateRunFinish';

/** Only a running controller run can complete; repeated turn-end notifications are no-ops. */
export async function teammateRunComplete(runId: string): Promise<void> {
    await inTx(async (tx) => { await teammateRunTerminateTx(tx, runId, 'completed', null, new Date(), { status: 'running' }); });
}
