import { Prisma } from '@prisma/client';
import { TeammateCreateRequestSchema, type TeammateCreateRequest } from 'happy-wire';
import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateDto } from './teammateQueries';
import { teammateUpdated } from './teammateUpdated';
import { teammateTimezoneValidate } from './teammateTimezoneValidate';
import { teammateRuntimeValidate } from './teammateRuntimeValidate';

/** Create only a profile in M1; the unique handle remains reserved after archival. */
export async function teammateCreate(accountId: string, input: TeammateCreateRequest) {
    const request = TeammateCreateRequestSchema.parse(input);
    teammateTimezoneValidate(request.timezone);
    teammateRuntimeValidate(request);
    try {
        return await inTx(async (tx) => {
            const machine = await tx.machine.findFirst({ where: { id: request.machineId, accountId }, select: { id: true } });
            if (!machine) throw new TeammateError('machine_not_found');
            const row = await tx.teammate.create({
                data: {
                    ...request,
                    accountId,
                    avatar: request.avatar ?? Prisma.DbNull,
                    activeHours: request.activeHours ?? Prisma.DbNull,
                },
            });
            const teammate = toTeammateDto(row);
            await teammateUpdated(tx, accountId, teammate);
            return teammate;
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const target = error.meta?.target;
            if (Array.isArray(target) && target.includes('accountId') && target.includes('handle')) {
                throw new TeammateError('handle_taken');
            }
        }
        throw error;
    }
}
