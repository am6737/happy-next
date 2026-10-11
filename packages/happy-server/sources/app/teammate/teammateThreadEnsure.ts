import { inTx, type Tx } from '@/storage/inTx';
import type { TeammateThreadKind } from 'happy-wire';

/** Serializable lookup/create keeps singleton and resource threads idempotent. */
export async function teammateThreadEnsure(teammateId: string, kind: TeammateThreadKind, options: { channelId?: string; taskId?: string } = {}, tx?: Tx) {
    const ensure = async (tx: Tx) => {
        const singleton = kind === 'heartbeat' || kind === 'dreaming';
        const where = { teammateId, kind, ...(singleton ? {} : { channelId: options.channelId ?? null, taskId: options.taskId ?? null }) };
        const existing = await tx.teammateThread.findFirst({ where });
        if (existing) return existing;
        return tx.teammateThread.create({ data: { teammateId, kind, ...(singleton ? {} : options) } });
    };
    return tx ? ensure(tx) : inTx(ensure);
}
