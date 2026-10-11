import { TEAMMATE_ENV, TeammateSessionMetadataSchema, type TeammateSessionMetadata } from 'happy-wire';
import { logger } from '@/ui/logger';
import type { Metadata } from '@/api/types';
import { mergeThreadState, mergeTaskWorker } from './homeDir';

/** Resolve the metadata once, when constructing the Happy session. */
export function teammateSessionMetadata(env: NodeJS.ProcessEnv = process.env): TeammateSessionMetadata | undefined {
    if (!env[TEAMMATE_ENV.teammateId]) return undefined;
    return TeammateSessionMetadataSchema.parse({
        id: env[TEAMMATE_ENV.teammateId], role: env[TEAMMATE_ENV.sessionRole] || 'controller',
        threadId: env[TEAMMATE_ENV.threadId],
        ...(env[TEAMMATE_ENV.taskId] ? { taskId: env[TEAMMATE_ENV.taskId] } : {}),
    });
}

/** Provider discovery must never interrupt a session on filesystem failure. */
export async function persistTeammateProviderSessionId(sessionId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const home = env[TEAMMATE_ENV.home];
    const threadId = env[TEAMMATE_ENV.threadId];
    if (!home || !threadId) return;
    try {
        if (env[TEAMMATE_ENV.sessionRole] === 'controller') {
            await mergeThreadState(home, threadId, { providerSessionId: sessionId });
        } else if (env[TEAMMATE_ENV.sessionRole] === 'worker' && env[TEAMMATE_ENV.workerId] && env[TEAMMATE_ENV.taskId]) {
            await mergeTaskWorker(home, env[TEAMMATE_ENV.taskId]!, env[TEAMMATE_ENV.workerId]!, { providerSessionId: sessionId });
        }
    } catch (error) {
        logger.debug('[TEAMMATE] Could not persist provider session ID', error);
    }
}

/** Shared by Claude and the Codex/Gemini metadata factory. Ignore malformed external context. */
export function teammateMetadataFields(env: NodeJS.ProcessEnv = process.env): Pick<Metadata, 'teammate' | 'externalContext'> {
    const fields: Pick<Metadata, 'teammate' | 'externalContext'> = { teammate: teammateSessionMetadata(env) };
    try {
        const context = JSON.parse(env[TEAMMATE_ENV.externalContext] ?? 'null');
        if (context?.source === 'github' && context.resourceType === 'issue'
            && typeof context.resourceId === 'string' && typeof context.title === 'string' && typeof context.deepLink === 'string') {
            fields.externalContext = context;
        }
    } catch { /* Invalid optional env must not prevent session startup. */ }
    return fields;
}
