import { z } from 'zod';
import {
    ChannelSchema, ChannelMessageSchema, ChannelCreateRequestSchema, ChannelMessageSendRequestSchema,
    ChannelMarkReadRequestSchema, ChannelMemberKeyUpdateRequestSchema, TeammateChannelMessageSendRequestSchema, ChannelUpdateRequestSchema, ChannelMembersAddRequestSchema,
} from 'happy-wire';
import type { Fastify } from '../types';
import { channelCreate } from '@/app/channel/channelCreate';
import { channelMessageSend } from '@/app/channel/channelMessageSend';
import { channelTeammateMessageSend } from '@/app/channel/channelTeammateMessageSend';
import { channelMarkRead } from '@/app/channel/channelMarkRead';
import { channelMemberKeyUpdate } from '@/app/channel/channelMemberKeyUpdate';
import { channelReset } from '@/app/channel/channelReset';
import { channelList, channelGet, channelMessageList, channelDmGet } from '@/app/channel/channelQueries';
import { ChannelError } from '@/app/channel/channelError';
import { TeammateError } from '@/app/teammate/teammateError';
import { channelUpdate } from '@/app/channel/channelUpdate';
import { channelMembersAdd } from '@/app/channel/channelMembersAdd';
import { channelMemberRemove } from '@/app/channel/channelMemberRemove';
import { channelDelete } from '@/app/channel/channelDelete';

const ErrorSchema = z.object({ error: z.string() });
const errors = { 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema };
const IdParams = z.object({ id: z.string().min(1) });
const ChannelResponse = z.object({ channel: ChannelSchema });
const MessageResponse = z.object({ message: ChannelMessageSchema });
const OkResponse = z.object({ ok: z.literal(true) });

/** Register the full conversation API with account auth, wire validators and daemon run authorization. */
export function channelRoutes(app: Fastify) {
    const common = {
        preHandler: app.authenticate,
        errorHandler: ((error, _request, reply) => {
            if (error instanceof ChannelError || error instanceof TeammateError) {
                const status = error.code === 'not_found' ? 404 : ['archived', 'no_dm', 'task_inactive', 'not_group', 'full', 'last_member'].includes(error.code) ? 409 : error.code === 'invalid_request' ? 400 : 403;
                return reply.code(status).send({ error: error.code });
            }
            if (error.validation || error.statusCode === 400 || error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
            return reply.send(error);
        }) satisfies NonNullable<Parameters<Fastify['route']>[0]['errorHandler']>,
    };
    app.get('/v1/channels', { ...common, schema: { response: { 200: z.object({ channels: z.array(ChannelSchema) }), ...errors } } }, async request => ({ channels: await channelList(request.userId) }));
    app.post('/v1/channels', { ...common, schema: { body: ChannelCreateRequestSchema, response: { 200: ChannelResponse, ...errors } } }, async request => ({ channel: await channelCreate(request.userId, request.body) }));
    app.get('/v1/channels/:id', { ...common, schema: { params: IdParams, response: { 200: ChannelResponse, ...errors } } }, async request => ({ channel: await channelGet(request.userId, request.params.id) }));
    app.get('/v1/channels/:id/messages', {
        ...common, schema: { params: IdParams, querystring: z.object({ afterSeq: z.coerce.number().int().min(0).optional(), beforeSeq: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), response: { 200: z.object({ messages: z.array(ChannelMessageSchema) }), ...errors } },
    }, async request => ({ messages: await channelMessageList(request.userId, request.params.id, request.query) }));
    app.post('/v1/channels/:id/messages', { ...common, schema: { params: IdParams, body: ChannelMessageSendRequestSchema, response: { 200: MessageResponse, ...errors } } }, async request => ({ message: await channelMessageSend({ accountId: request.userId, channelId: request.params.id, sender: { type: 'user', accountId: request.userId }, req: request.body }) }));
    app.post('/v1/channels/:id/read', { ...common, schema: { params: IdParams, body: ChannelMarkReadRequestSchema, response: { 200: OkResponse, ...errors } } }, async request => {
        await channelMarkRead(request.userId, request.params.id, request.body.seq); return { ok: true as const };
    });
    app.post('/v1/channels/:id/reset', { ...common, schema: { params: IdParams, response: { 200: OkResponse, ...errors } } }, async request => {
        await channelReset(request.userId, request.params.id); return { ok: true as const };
    });
    app.patch('/v1/channels/:id', { ...common, schema: { params: IdParams, body: ChannelUpdateRequestSchema, response: { 200: ChannelResponse, ...errors } } }, async request => ({ channel: await channelUpdate(request.userId, request.params.id, request.body) }));
    app.post('/v1/channels/:id/members', { ...common, schema: { params: IdParams, body: ChannelMembersAddRequestSchema, response: { 200: ChannelResponse, ...errors } } }, async request => ({ channel: await channelMembersAdd(request.userId, request.params.id, request.body) }));
    app.delete('/v1/channels/:id/members/:teammateId', { ...common, schema: { params: IdParams.extend({ teammateId: z.string().min(1) }), response: { 200: ChannelResponse, ...errors } } }, async request => ({ channel: await channelMemberRemove(request.userId, request.params.id, request.params.teammateId) }));
    app.delete('/v1/channels/:id', { ...common, schema: { params: IdParams, response: { 200: OkResponse, ...errors } } }, async request => channelDelete(request.userId, request.params.id));
    app.post('/v1/channels/:id/members/:teammateId/key', { ...common, schema: { params: IdParams.extend({ teammateId: z.string().min(1) }), body: ChannelMemberKeyUpdateRequestSchema, response: { 200: OkResponse, ...errors } } }, async request => {
        await channelMemberKeyUpdate(request.userId, request.params.id, request.params.teammateId, request.body.encryptedDataKey); return { ok: true as const };
    });
    app.post('/v1/teammate-channel-messages', { ...common, schema: { body: TeammateChannelMessageSendRequestSchema, response: { 200: MessageResponse, ...errors } } }, async request => ({ message: await channelTeammateMessageSend(request.userId, request.body) }));
    app.get('/v1/teammates/:id/dm', { ...common, schema: { params: IdParams, response: { 200: z.object({ channel: ChannelSchema.nullable() }), ...errors } } }, async request => ({ channel: await channelDmGet(request.userId, request.params.id) }));
}
