import type { Tx } from '@/storage/inTx';
import { accountUpdateEmit } from '@/app/events/accountUpdateEmit';
import type { TeammateRun } from 'happy-wire';

/** Publish the run snapshot for every persisted run transition. */
export async function teammateRunUpdated(tx: Tx, accountId: string, run: TeammateRun): Promise<void> {
    await accountUpdateEmit(tx, accountId, { t: 'teammate-run-updated', run });
}
