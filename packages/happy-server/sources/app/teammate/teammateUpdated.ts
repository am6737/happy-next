import type { Tx } from '@/storage/inTx';
import { accountUpdateEmit } from '@/app/events/accountUpdateEmit';
import type { Teammate } from 'happy-wire';

/** Publish the profile snapshot shared by create, update and archive. */
export async function teammateUpdated(tx: Tx, accountId: string, teammate: Teammate): Promise<void> {
    await accountUpdateEmit(tx, accountId, { t: 'teammate-updated', teammate });
}
