import {
    TEAMMATE_RPC_DRAFT, TeammateDraftResponseSchema,
    type TeammateDraft, type TeammateDraftAnswer, type TeammateDraftQuestion, type TeammateDraftRequest,
} from 'happy-wire';
import { apiSocket } from './apiSocket';
import { t } from '@/text';

const MISSING_METHOD = /method not available|method not found|unknown method/i;
// Matches the request schema; the oldest answers are dropped first on very long interviews.
const MAX_ANSWERS = 20;
// Claude usually answers in 20-60s; the server forwards for up to 110s, so wait a little longer here.
const DRAFT_RPC_TIMEOUT_MS = 115_000;

export type TeammateSeed = { draft: TeammateDraft; machineId: string };
export type TeammateDraftRound = { draft: TeammateDraft; questions: TeammateDraftQuestion[] };

export type TeammateDraftField = 'name' | 'role' | 'skills' | 'instructions';

// Drafts are handed from the AI interview to the confirm form in memory: they can hold long instructions
// that do not belong in a URL. A seed is read once and dropped.
const seeds = new Map<string, TeammateSeed>();

export function putTeammateSeed(seed: TeammateSeed): string {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    seeds.set(key, seed);
    return key;
}

export function takeTeammateSeed(key: string): TeammateSeed | undefined {
    const seed = seeds.get(key);
    seeds.delete(key);
    return seed;
}

/** Asks the CLI on `machineId` for one drafting round: an updated draft plus follow-up questions. */
export async function generateTeammateDraft(machineId: string, request: TeammateDraftRequest): Promise<TeammateDraftRound> {
    let raw: unknown;
    try {
        raw = await apiSocket.machineRPC<unknown, TeammateDraftRequest>(machineId, TEAMMATE_RPC_DRAFT, request, DRAFT_RPC_TIMEOUT_MS);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // CLIs released before drafting existed do not register the handler.
        if (MISSING_METHOD.test(message)) throw new Error(t('teammates.ai.updateCli'));
        throw error;
    }
    const parsed = TeammateDraftResponseSchema.safeParse(raw);
    if (!parsed.success) {
        const error = (raw as { error?: unknown } | null)?.error;
        throw new Error(typeof error === 'string' && MISSING_METHOD.test(error) ? t('teammates.ai.updateCli') : t('teammates.ai.invalidResponse'));
    }
    if (!parsed.data.ok) throw new Error(parsed.data.error);
    return { draft: parsed.data.draft, questions: parsed.data.questions };
}

/**
 * Appends one round's replies to the earlier answers. `replies[i]` answers `questions[i]`; a skipped or blank
 * reply is left out. Only the newest answers that fit the request schema are kept.
 */
export function mergeDraftAnswers(previous: TeammateDraftAnswer[], questions: TeammateDraftQuestion[], replies: (string | undefined)[]): TeammateDraftAnswer[] {
    const added = questions.flatMap((question, index) => {
        const answer = replies[index]?.trim();
        return answer ? [{ question: question.question, answer }] : [];
    });
    return [...previous, ...added].slice(-MAX_ANSWERS);
}

/** Draft fields that changed since the previous round; nothing on the first round. */
export function changedDraftFields(previous: TeammateDraft | undefined, next: TeammateDraft): TeammateDraftField[] {
    if (!previous) return [];
    const fields: TeammateDraftField[] = ['name', 'role', 'skills', 'instructions'];
    return fields.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
}
