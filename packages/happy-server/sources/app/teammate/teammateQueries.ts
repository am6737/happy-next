import { db } from '@/storage/db';
import type { Teammate as TeammateRow, TeammateRun as RunRow, TeammateTask as TaskRow, TeammateThread } from '@prisma/client';
import {
    TeammateSchema, TeammateAvatarSchema, TeammateActiveHoursSchema,
    TeammateRunSchema, TeammateTaskSchema,
    type Teammate, type TeammateRun, type TeammateTask,
} from 'happy-wire';

type TaskRowCompat = Omit<TaskRow, 'reviewerTeammateId' | 'parentTaskId' | 'reviewRound'>
    & Partial<Pick<TaskRow, 'reviewerTeammateId' | 'parentTaskId' | 'reviewRound'>>;

/** Convert the profile to wire data, tolerating malformed optional JSON. */
export function toTeammateDto(row: TeammateRow): Teammate {
    const avatar = TeammateAvatarSchema.safeParse(row.avatar);
    const activeHours = TeammateActiveHoursSchema.safeParse(row.activeHours);
    return TeammateSchema.parse({
        ...row,
        timezone: row.timezone ?? null,
        avatar: avatar.success ? avatar.data : null,
        activeHours: activeHours.success ? activeHours.data : null,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
    });
}

/** Include the thread kind and serialize nullable run timestamps. */
export function toTeammateRunDto(row: RunRow & { thread: Pick<TeammateThread, 'kind'> }): TeammateRun {
    return TeammateRunSchema.parse({
        ...row,
        threadKind: row.thread.kind,
        queuedAt: row.queuedAt.getTime(),
        startedAt: row.startedAt?.getTime() ?? null,
        finishedAt: row.finishedAt?.getTime() ?? null,
        tokens: row.inputTokens == null ? null : {
            input: row.inputTokens,
            cacheRead: row.cacheReadTokens ?? 0,
            cacheWrite: row.cacheWriteTokens ?? 0,
            output: row.outputTokens ?? 0,
        },
    });
}

/** Serialize task timestamps without exposing account ownership fields. */
export function toTeammateTaskDto(row: TaskRowCompat): TeammateTask {
    return TeammateTaskSchema.parse({
        ...row,
        createdByTeammateId: row.createdByTeammateId ?? null,
        reviewerTeammateId: row.reviewerTeammateId ?? null,
        parentTaskId: row.parentTaskId ?? null,
        reviewRound: row.reviewRound ?? 0,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
    });
}

/** List only this account's teammates, newest first. */
export async function teammateList(accountId: string, includeArchived = false): Promise<Teammate[]> {
    const rows = await db.teammate.findMany({
        where: { accountId, ...(includeArchived ? {} : { status: { not: 'archived' } }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toTeammateDto);
}

/** Return null for both missing profiles and profiles owned by another account. */
export async function teammateGet(accountId: string, teammateId: string): Promise<Teammate | null> {
    const row = await db.teammate.findFirst({ where: { id: teammateId, accountId } });
    return row ? toTeammateDto(row) : null;
}

/** List runs before an exclusive queuedAt cursor, including their thread kinds. */
export async function teammateRunList(accountId: string, teammateId: string, limit = 50, before?: number): Promise<TeammateRun[] | null> {
    if (!await teammateGet(accountId, teammateId)) return null;
    const rows = await db.teammateRun.findMany({
        where: {
            teammateId,
            teammate: { accountId },
            ...(before === undefined ? {} : { queuedAt: { lt: new Date(before) } }),
        },
        include: { thread: { select: { kind: true } } },
        orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
        take: Math.min(200, Math.max(1, limit)),
    });
    return rows.map(toTeammateRunDto);
}

/** Active tasks exclude done and cancelled; all tasks are sorted by latest change. */
export async function teammateTaskList(accountId: string, teammateId: string, status: 'active' | 'all' = 'all'): Promise<TeammateTask[] | null> {
    if (!await teammateGet(accountId, teammateId)) return null;
    const rows = await db.teammateTask.findMany({
        where: { accountId, teammateId, ...(status === 'active' ? { status: { notIn: ['done', 'cancelled'] } } : {}) },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toTeammateTaskDto);
}
