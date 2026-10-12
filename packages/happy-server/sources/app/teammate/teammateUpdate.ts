import { Prisma } from '@prisma/client';
import { TeammateUpdateRequestSchema, TeammateControllerProviderSchema, TeammateWorkerProviderSchema, type TeammateUpdateRequest } from 'happy-wire';
import { inTx } from '@/storage/inTx';
import { TeammateError } from './teammateError';
import { toTeammateDto } from './teammateQueries';
import { teammateUpdated } from './teammateUpdated';
import { teammateTimezoneValidate } from './teammateTimezoneValidate';
import { teammateRuntimeValidate } from './teammateRuntimeValidate';
import { teammateBudgetEvaluate } from './teammateBudgetEvaluate';
import { teammateNameAssertFree } from './teammateIdentity';

/** Apply only supplied fields; serializable transactions prevent editing an archived profile. */
export async function teammateUpdate(accountId: string, teammateId: string, input: TeammateUpdateRequest) {
    const request = TeammateUpdateRequestSchema.parse(input);
    teammateTimezoneValidate(request.timezone);
    const teammate = await inTx(async (tx) => {
        const existing = await tx.teammate.findFirst({ where: { id: teammateId, accountId } });
        if (!existing) throw new TeammateError('not_found');
        if (existing.status === 'archived') throw new TeammateError('archived');
        teammateRuntimeValidate({
            controllerProvider: request.controllerProvider ?? TeammateControllerProviderSchema.parse(existing.controllerProvider),
            controllerPermissionMode: request.controllerPermissionMode ?? existing.controllerPermissionMode,
            workerProvider: request.workerProvider ?? TeammateWorkerProviderSchema.parse(existing.workerProvider),
            workerPermissionMode: request.workerPermissionMode ?? existing.workerPermissionMode,
        });
        if (request.name !== undefined && request.name.toLowerCase() !== existing.name.toLowerCase()) await teammateNameAssertFree(tx, accountId, request.name, teammateId);
        if (request.machineId !== undefined && request.machineId !== existing.machineId) {
            const machine = await tx.machine.findFirst({ where: { id: request.machineId, accountId }, select: { id: true } });
            if (!machine) throw new TeammateError('machine_not_found');
        }
        const row = await tx.teammate.update({
            where: { id: teammateId, accountId },
            data: {
                ...request,
                ...(request.avatar === undefined ? {} : { avatar: request.avatar ?? Prisma.DbNull }),
                ...(request.activeHours === undefined ? {} : { activeHours: request.activeHours ?? Prisma.DbNull }),
            },
        });
        const teammate = toTeammateDto(row);
        await teammateUpdated(tx, accountId, teammate);
        return teammate;
    });
    if (request.monthlyBudgetUsd !== undefined || request.status !== undefined) await teammateBudgetEvaluate(teammateId).catch(() => {});
    return teammate;
}
