import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateDto } from './teammateQueries';
import { teammateUpdated } from './teammateUpdated';

/** Archive idempotently, preserving the handle, history and original archival timestamp. */
export async function teammateArchive(accountId: string, teammateId: string) {
    return inTx(async (tx) => {
        const existing = await tx.teammate.findFirst({ where: { id: teammateId, accountId } });
        if (!existing) throw new TeammateError('not_found');
        const row = existing.status === 'archived' ? existing : await tx.teammate.update({
            where: { id: teammateId, accountId },
            data: { status: 'archived' },
        });
        const teammate = toTeammateDto(row);
        await teammateUpdated(tx, accountId, teammate);
        return teammate;
    });
}
