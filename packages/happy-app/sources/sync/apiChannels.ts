import { z } from 'zod';
import {
    ChannelSchema, ChannelMessageSchema, ChannelCreateRequestSchema, ChannelMessageSendRequestSchema,
    ChannelMemberKeyUpdateRequestSchema, ChannelMarkReadRequestSchema, ChannelUpdateRequestSchema, ChannelMembersAddRequestSchema,
    type Channel, type ChannelMessage, type ChannelCreateRequest, type ChannelMessageSendRequest,
    type ChannelMemberKeyUpdateRequest, type ChannelMarkReadRequest, type ChannelUpdateRequest, type ChannelMembersAddRequest,
} from 'happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';

export class ChannelApiError extends Error {
    constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export async function channelRequest<T>(credentials: AuthCredentials, path: string, schema: z.ZodType<T>, body?: unknown, method?: 'PATCH' | 'DELETE'): Promise<T> {
    const url = `${getServerUrl()}/v1/${path}`;
    let attempts = 0;
    const perform = async (): Promise<{ response: Response } | { error: unknown }> => {
        attempts++;
        try {
            const response = await fetch(url, {
                method: method ?? (body === undefined ? 'GET' : 'POST'),
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
    if (!result.response.ok) {
        const data = await result.response.json().catch(() => ({}));
        throw new ChannelApiError(result.response.status, typeof data.error === 'string' ? data.error : 'unknown');
    }
    return schema.parse(await result.response.json());
}
const channelResponse = z.object({ channel: ChannelSchema });
const okResponse = z.object({ ok: z.literal(true) });
const pathFor = (id: string) => `channels/${encodeURIComponent(id)}`;
export async function fetchChannels(credentials: AuthCredentials): Promise<Channel[]> {
    return (await channelRequest(credentials, 'channels', z.object({ channels: z.array(ChannelSchema) }))).channels;
}
export async function createChannel(credentials: AuthCredentials, body: ChannelCreateRequest): Promise<Channel> {
    return (await channelRequest(credentials, 'channels', channelResponse, ChannelCreateRequestSchema.parse(body))).channel;
}
export async function fetchChannel(credentials: AuthCredentials, id: string): Promise<Channel> {
    return (await channelRequest(credentials, pathFor(id), channelResponse)).channel;
}
export async function fetchChannelMessages(credentials: AuthCredentials, id: string, query: { afterSeq?: number; beforeSeq?: number; limit?: number } = {}): Promise<ChannelMessage[]> {
    const params = new URLSearchParams();
    for (const field of ['afterSeq', 'beforeSeq'] as const) if (query[field] !== undefined) params.set(field, String(query[field]));
    params.set('limit', String(Math.max(1, Math.min(200, query.limit ?? 50))));
    return (await channelRequest(credentials, `${pathFor(id)}/messages?${params}`, z.object({ messages: z.array(ChannelMessageSchema) }))).messages;
}
export async function sendChannelMessage(credentials: AuthCredentials, id: string, body: ChannelMessageSendRequest): Promise<ChannelMessage> {
    return (await channelRequest(credentials, `${pathFor(id)}/messages`, z.object({ message: ChannelMessageSchema }), ChannelMessageSendRequestSchema.parse(body))).message;
}
export async function markChannelRead(credentials: AuthCredentials, id: string, body: ChannelMarkReadRequest): Promise<void> {
    await channelRequest(credentials, `${pathFor(id)}/read`, okResponse, ChannelMarkReadRequestSchema.parse(body));
}
export async function resetChannel(credentials: AuthCredentials, id: string): Promise<void> {
    await channelRequest(credentials, `${pathFor(id)}/reset`, okResponse, {});
}
export async function updateChannelMemberKey(credentials: AuthCredentials, id: string, teammateId: string, body: ChannelMemberKeyUpdateRequest): Promise<void> {
    await channelRequest(credentials, `${pathFor(id)}/members/${encodeURIComponent(teammateId)}/key`, okResponse, ChannelMemberKeyUpdateRequestSchema.parse(body));
}
export async function updateChannel(credentials: AuthCredentials, id: string, body: ChannelUpdateRequest): Promise<Channel> {
    return (await channelRequest(credentials, pathFor(id), channelResponse, ChannelUpdateRequestSchema.parse(body), 'PATCH')).channel;
}
export async function addChannelMembers(credentials: AuthCredentials, id: string, body: ChannelMembersAddRequest): Promise<Channel> {
    return (await channelRequest(credentials, `${pathFor(id)}/members`, channelResponse, ChannelMembersAddRequestSchema.parse(body))).channel;
}
export async function removeChannelMember(credentials: AuthCredentials, id: string, teammateId: string): Promise<Channel> {
    return (await channelRequest(credentials, `${pathFor(id)}/members/${encodeURIComponent(teammateId)}`, channelResponse, undefined, 'DELETE')).channel;
}
export async function deleteChannel(credentials: AuthCredentials, id: string): Promise<void> {
    await channelRequest(credentials, pathFor(id), okResponse, undefined, 'DELETE');
}
export async function fetchTeammateDm(credentials: AuthCredentials, teammateId: string): Promise<Channel | null> {
    return (await channelRequest(credentials, `teammates/${encodeURIComponent(teammateId)}/dm`, z.object({ channel: ChannelSchema.nullable() }))).channel;
}
