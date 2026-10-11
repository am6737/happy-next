import { z } from 'zod';
import { GithubIssueResourceIdSchema, TeammateTaskSchema, TeammateTaskDetailSchema, TeammateTaskDelegateRequestSchema,
    type TeammateTask, type TeammateTaskDetail, type TeammateTaskDelegateRequest } from 'happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { channelRequest } from './apiChannels';

// Shares the validated, authenticated transport: GET retries; writes are never replayed.
const taskResponse = z.object({ task: TeammateTaskSchema });
const pathFor = (id: string) => `teammate-tasks/${encodeURIComponent(id)}`;
export async function delegateTeammateTask(credentials: AuthCredentials, body: TeammateTaskDelegateRequest): Promise<TeammateTask> {
    return (await channelRequest(credentials, 'teammate-tasks', taskResponse, TeammateTaskDelegateRequestSchema.parse(body))).task;
}
export async function fetchTeammateTasksByResource(credentials: AuthCredentials, resourceId: string): Promise<TeammateTask[]> {
    GithubIssueResourceIdSchema.parse(resourceId);
    return (await channelRequest(credentials, `teammate-tasks?resourceId=${encodeURIComponent(resourceId)}`, z.object({ tasks: z.array(TeammateTaskSchema) }))).tasks;
}
export async function fetchTeammateTaskDetail(credentials: AuthCredentials, id: string): Promise<TeammateTaskDetail> {
    return channelRequest(credentials, pathFor(id), TeammateTaskDetailSchema);
}
export async function updateTeammateTask(credentials: AuthCredentials, id: string, action: 'stop' | 'resume' | 'cancel'): Promise<TeammateTask> {
    return (await channelRequest(credentials, `${pathFor(id)}/${action}`, taskResponse, {})).task;
}
