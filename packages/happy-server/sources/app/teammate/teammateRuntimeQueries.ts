import { db } from '@/storage/db';
import { toTeammateRunDto } from './teammateQueries';

/** Read one run with account isolation, excluding tokens and internal event payloads. */
export async function teammateRunGet(accountId: string, runId: string) {
    const row = await db.teammateRun.findFirst({ where: { id: runId, teammate: { accountId } }, include: { thread: true } });
    return row ? toTeammateRunDto(row) : null;
}

/** List only registered controllers used by in-flight runs on this account's machine. */
export async function teammateActiveSessions(accountId: string, machineId: string): Promise<string[]> {
    const runs = await db.teammateRun.findMany({ where: { teammate: { accountId, machineId }, status: { in: ['dispatching', 'running'] } }, select: { sessionId: true, status: true, thread: { select: { currentSessionId: true } } } });
    // started has not supplied run.sessionId yet when reusing a dispatching thread.
    const sessionIds = runs.flatMap((run) => {
        const sessionId = run.sessionId ?? (run.status === 'dispatching' ? run.thread.currentSessionId : null);
        return sessionId ? [sessionId] : [];
    });
    const sessions = await db.teammateSession.findMany({
        where: { role: 'controller', teammate: { accountId, machineId }, sessionId: { in: sessionIds } },
        select: { sessionId: true },
    });
    return sessions.map((session) => session.sessionId);
}
