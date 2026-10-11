import { z } from 'zod';
import {
    TeammateSchema, TeammateRunSchema, TeammateTaskSchema, TeammateSpendSchema,
    TeammateCreateRequestSchema, TeammateUpdateRequestSchema, TeammateManualRunRequestSchema, TeammateScheduledRunResponseSchema,
    type Teammate, type TeammateRun, type TeammateTask, type TeammateSpend,
    type TeammateCreateRequest, type TeammateUpdateRequest, type TeammateManualRunRequest,
} from 'happy-wire';
import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export type TeammateErrorCode = 'handle_taken' | 'machine_not_found' | 'archived' | 'invalid_request' | 'invalid_timezone' | 'not_found' | 'unknown';
export class TeammateApiError extends Error {
    constructor(public readonly code: TeammateErrorCode, public readonly status: number) {
        super(code);
        this.name = 'TeammateApiError';
    }
}

async function request<T>(credentials: AuthCredentials, path: string, schema: z.ZodType<T>, body?: unknown, resource = 'teammates'): Promise<T> {
    const url = `${getServerUrl()}/v1/${resource}${path}`;
    let attempts = 0;
    // Writes are never retried: a lost response may already have created a colleague.
    const perform = async (): Promise<{ response: Response } | { error: unknown }> => {
        attempts++;
        try {
            const response = await fetch(url, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            if (body === undefined && response.status >= 500 && attempts < 3) throw new Error(`HTTP ${response.status}`);
            return { response };
        } catch (error) {
            if (body === undefined && attempts < 3) throw error;
            return { error };
        }
    };
    const result = body === undefined ? await backoff(perform) : await perform();
    if ('error' in result) throw result.error;
    const { response } = result;
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const codes: TeammateErrorCode[] = ['handle_taken', 'machine_not_found', 'archived', 'invalid_request', 'invalid_timezone', 'not_found'];
        throw new TeammateApiError(codes.includes(data.error) ? data.error : 'unknown', response.status);
    }
    return schema.parse(await response.json());
}

const teammateResponse = z.object({ teammate: TeammateSchema });
const runResponse = z.object({ run: TeammateRunSchema });
const pathFor = (id: string) => `/${encodeURIComponent(id)}`;
export async function fetchTeammates(credentials: AuthCredentials, includeArchived = false): Promise<Teammate[]> {
    return (await request(credentials, `?includeArchived=${includeArchived}`, z.object({ teammates: z.array(TeammateSchema) }))).teammates;
}
export async function createTeammate(credentials: AuthCredentials, body: TeammateCreateRequest): Promise<Teammate> {
    return (await request(credentials, '', teammateResponse, TeammateCreateRequestSchema.parse(body))).teammate;
}
export async function fetchTeammate(credentials: AuthCredentials, id: string): Promise<Teammate> {
    return (await request(credentials, pathFor(id), teammateResponse)).teammate;
}
export async function updateTeammate(credentials: AuthCredentials, id: string, body: TeammateUpdateRequest): Promise<Teammate> {
    return (await request(credentials, pathFor(id), teammateResponse, TeammateUpdateRequestSchema.parse(body))).teammate;
}
export async function archiveTeammate(credentials: AuthCredentials, id: string): Promise<Teammate> {
    return (await request(credentials, `${pathFor(id)}/archive`, teammateResponse, {})).teammate;
}
export async function fetchTeammateRuns(credentials: AuthCredentials, id: string, query: { limit?: number; before?: number } = {}): Promise<TeammateRun[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(Math.max(1, Math.min(200, query.limit))));
    if (query.before !== undefined) params.set('before', String(query.before));
    return (await request(credentials, `${pathFor(id)}/runs?${params}`, z.object({ runs: z.array(TeammateRunSchema) }))).runs;
}
export async function startTeammateRun(credentials: AuthCredentials, id: string, body: TeammateManualRunRequest): Promise<{ run: TeammateRun }> {
    return request(credentials, `${pathFor(id)}/runs`, runResponse, TeammateManualRunRequestSchema.parse(body));
}
export async function triggerHeartbeat(credentials: AuthCredentials, id: string): Promise<{ run: TeammateRun }> {
    return request(credentials, `${pathFor(id)}/heartbeat`, TeammateScheduledRunResponseSchema, {});
}
export async function triggerDreaming(credentials: AuthCredentials, id: string): Promise<{ run: TeammateRun }> {
    return request(credentials, `${pathFor(id)}/dreaming`, TeammateScheduledRunResponseSchema, {});
}
export async function cancelTeammateRun(credentials: AuthCredentials, runId: string): Promise<{ run: TeammateRun }> {
    return request(credentials, `${pathFor(runId)}/cancel`, runResponse, {}, 'teammate-runs');
}
export async function retryTeammateRun(credentials: AuthCredentials, runId: string): Promise<{ run: TeammateRun }> {
    return request(credentials, `${pathFor(runId)}/retry`, runResponse, {}, 'teammate-runs');
}
export async function fetchTeammateRun(credentials: AuthCredentials, runId: string): Promise<{ run: TeammateRun }> {
    return request(credentials, pathFor(runId), runResponse, undefined, 'teammate-runs');
}
export async function fetchTeammateTasks(credentials: AuthCredentials, id: string, status: 'active' | 'all' = 'all'): Promise<TeammateTask[]> {
    return (await request(credentials, `${pathFor(id)}/tasks?status=${status}`, z.object({ tasks: z.array(TeammateTaskSchema) }))).tasks;
}
export async function fetchTeammateSpend(credentials: AuthCredentials, id: string): Promise<TeammateSpend> {
    return (await request(credentials, `${pathFor(id)}/spend`, z.object({ spend: TeammateSpendSchema }))).spend;
}
