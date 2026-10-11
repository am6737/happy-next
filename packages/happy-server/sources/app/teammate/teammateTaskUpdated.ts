import type { Tx } from '@/storage/inTx';
import { accountUpdateEmit } from '@/app/events/accountUpdateEmit';
import type { TeammateTask } from 'happy-wire';

/** Publish the task snapshot scoped to its owning account. */
export async function teammateTaskUpdated(tx: Tx, accountId: string, task: TeammateTask): Promise<void> {
    await accountUpdateEmit(tx, accountId, { t: 'teammate-task-updated', task });
}
