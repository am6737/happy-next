import type { Teammate } from '@prisma/client';
import { TEAMMATE_RPC_NOTIFY, TeammateNotifyPayloadSchema } from 'happy-wire';
import { afterTx, type Tx } from '@/storage/inTx';
import { invokeUserRpc } from '@/app/api/socket/rpcRegistry';

/** Send a best-effort daemon notification only after the enclosing transaction commits. */
export function teammateNotify(tx: Tx, teammate: Teammate, title: string, body: string, data: Record<string, unknown>): void {
    const payload = TeammateNotifyPayloadSchema.parse({ teammateId: teammate.id, title, body, data });
    afterTx(tx, () => { void invokeUserRpc(teammate.accountId, `${teammate.machineId}:${TEAMMATE_RPC_NOTIFY}`, payload, 30_000).catch(() => {}); });
}
