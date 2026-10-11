import { teammateTaskWake } from './teammateTaskWake';
import { db } from '@/storage/db';
import { teammateSessionLookup } from './teammateSessionCache';
import { teammateRunComplete } from './teammateRunComplete';

/** Complete running controllers or wake the parent task when a registered worker becomes idle. */
export async function teammateOnSessionTurnEnded(sessionId: string): Promise<void> {
    const session = await teammateSessionLookup(sessionId);
    if (!session) return;
    if (session.role === 'controller') {
        const runs = await db.teammateRun.findMany({ where: { sessionId, teammateId: session.teammateId, threadId: session.threadId, status: 'running' }, select: { id: true } });
        for (const run of runs) await teammateRunComplete(run.id);
    }
    if (session.role === 'worker' && session.taskId) {
        await teammateTaskWake(session.taskId, { type: 'work-session-idle', at: Date.now(), data: { taskId: session.taskId, sessionId } });
    }
}
