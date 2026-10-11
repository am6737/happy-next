import { db } from '@/storage/db';
import { TeammateTaskDetailSchema } from 'happy-wire';
import { toTeammateTaskDto, toTeammateRunDto } from './teammateQueries';
import { TeammateError } from './teammateError';

/** List this account's issue delegations in creation order, newest first. */
export async function teammateTaskListByResource(accountId: string, resourceId: string) {
    const rows = await db.teammateTask.findMany({ where: { accountId, resourceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(toTeammateTaskDto);
}

/** Return owned task details with oldest-first sessions and the newest fifty execution attempts. */
export async function teammateTaskDetail(accountId: string, taskId: string) {
    const task = await db.teammateTask.findFirst({ where: { id: taskId, accountId } });
    if (!task) throw new TeammateError('not_found');
    const [sessions, runs] = await Promise.all([
        db.teammateSession.findMany({ where: { taskId }, orderBy: [{ createdAt: 'asc' }, { sessionId: 'asc' }] }),
        db.teammateRun.findMany({ where: { taskId }, include: { thread: true }, orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }], take: 50 }),
    ]);
    return TeammateTaskDetailSchema.parse({ task: toTeammateTaskDto(task), sessions: sessions.map(s => ({ sessionId: s.sessionId, role: s.role, createdAt: s.createdAt.getTime() })), runs: runs.map(toTeammateRunDto) });
}
