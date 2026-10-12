import { Prisma } from '@prisma/client';
import { TeammateCreateRequestSchema, type TeammateCreateRequest } from 'happy-wire';
import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateDto } from './teammateQueries';
import { teammateUpdated } from './teammateUpdated';
import { teammateTimezoneValidate } from './teammateTimezoneValidate';
import { teammateRuntimeValidate } from './teammateRuntimeValidate';
import { teammateHandleAllocate, teammateNameAssertFree } from './teammateIdentity';

/** Create only a profile in M1; the name must be free and the internal handle is allocated here. */
export async function teammateCreate(accountId: string, input: TeammateCreateRequest) {
    const { handle: handleHint, ...request } = TeammateCreateRequestSchema.parse(input);
    teammateTimezoneValidate(request.timezone);
    teammateRuntimeValidate(request);
    return await inTx(async (tx) => {
        const machine = await tx.machine.findFirst({ where: { id: request.machineId, accountId }, select: { id: true } });
        if (!machine) throw new TeammateError('machine_not_found');
        await teammateNameAssertFree(tx, accountId, request.name);
        const row = await tx.teammate.create({
            data: {
                ...request,
                handle: await teammateHandleAllocate(tx, accountId, request.name, handleHint),
                accountId,
                avatar: request.avatar ?? Prisma.DbNull,
                activeHours: request.activeHours ?? Prisma.DbNull,
            },
        });
        const teammate = toTeammateDto(row);
        await teammateUpdated(tx, accountId, teammate);
        return teammate;
    });
}
