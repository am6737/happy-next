import { z } from 'zod';
import {
    TeammateSchema, TeammateCreateRequestSchema, TeammateUpdateRequestSchema,
    TeammateRunSchema, TeammateTaskSchema, TeammateSpendSchema,
    TeammateManualRunRequestSchema, TeammateRunStartedRequestSchema, TeammateRunFinishedRequestSchema,
    TeammateContextEventRequestSchema,
    TeammateActiveSessionsResponseSchema,
    TeammateScheduledRunResponseSchema,
} from 'happy-wire';
import type { Fastify } from '../types';
import { teammateCreate } from '@/app/teammate/teammateCreate';
import { teammateUpdate } from '@/app/teammate/teammateUpdate';
import { teammateArchive } from '@/app/teammate/teammateArchive';
import { teammateGet, teammateList, teammateRunList, teammateTaskList } from '@/app/teammate/teammateQueries';
import { teammateSpendGet } from '@/app/teammate/teammateSpend';
import { TeammateError } from '@/app/teammate/teammateError';

import { teammateThreadEnsure } from '@/app/teammate/teammateThreadEnsure';
import { teammateRunEnqueue } from '@/app/teammate/teammateRunEnqueue';
import { teammateRunStart } from '@/app/teammate/teammateRunStart';
import { teammateRunFinish } from '@/app/teammate/teammateRunFinish';
import { teammateRunCancel } from '@/app/teammate/teammateRunCancel';
import { teammateRunRetry } from '@/app/teammate/teammateRunRetry';
import { teammateRunGet, teammateActiveSessions } from '@/app/teammate/teammateRuntimeQueries';
import { teammateManualScheduledRun } from '@/app/teammate/teammateDreamingTick';
import { teammateRunContextEvent } from '@/app/teammate/teammateRunContextEvent';

const ErrorSchema = z.object({ error: z.string() });
const ProfileResponseSchema = z.object({ teammate: TeammateSchema });
const IdParamsSchema = z.object({ id: z.string().min(1) });
const errorResponses = { 403: ErrorSchema, 400: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema };

/** Register account-authenticated identity and runtime endpoints with shared wire validators. */
export function teammateRoutes(app: Fastify) {
    const common = {
        preHandler: app.authenticate,
        errorHandler: ((error, _request, reply) => {
            if (error instanceof TeammateError) {
                const status = error.code === 'invalid_token' ? 403 : error.code === 'not_found' ? 404
                    : ['machine_not_found', 'invalid_timezone'].includes(error.code) ? 400 : 409;
                return reply.code(status).send({ error: error.code });
            }
            if (error.validation || error.statusCode === 400) {
                return reply.code(400).send({ error: 'invalid_request' });
            }
            // Delegate authentication and unexpected errors to the app's error handler.
            return reply.send(error);
        }) satisfies NonNullable<Parameters<Fastify['route']>[0]['errorHandler']>,
    };

    app.get('/v1/teammates', {
        ...common,
        schema: {
            querystring: z.object({ includeArchived: z.enum(['true', 'false']).default('false') }),
            response: { 200: z.object({ teammates: z.array(TeammateSchema) }), ...errorResponses },
        },
    }, async (request) => ({ teammates: await teammateList(request.userId, request.query.includeArchived === 'true') }));

    app.post('/v1/teammates', {
        ...common,
        schema: { body: TeammateCreateRequestSchema, response: { 200: ProfileResponseSchema, ...errorResponses } },
    }, async (request) => ({ teammate: await teammateCreate(request.userId, request.body) }));

    app.get('/v1/teammates/:id', {
        ...common,
        schema: { params: IdParamsSchema, response: { 200: ProfileResponseSchema, ...errorResponses } },
    }, async (request, reply) => {
        const teammate = await teammateGet(request.userId, request.params.id);
        if (!teammate) return reply.code(404).send({ error: 'not_found' });
        return { teammate };
    });

    app.post('/v1/teammates/:id', {
        ...common,
        schema: { params: IdParamsSchema, body: TeammateUpdateRequestSchema, response: { 200: ProfileResponseSchema, ...errorResponses } },
    }, async (request) => ({ teammate: await teammateUpdate(request.userId, request.params.id, request.body) }));

    app.post('/v1/teammates/:id/archive', {
        ...common,
        schema: { params: IdParamsSchema, response: { 200: ProfileResponseSchema, ...errorResponses } },
    }, async (request) => ({ teammate: await teammateArchive(request.userId, request.params.id) }));

    app.get('/v1/teammates/:id/runs', {
        ...common,
        schema: {
            params: IdParamsSchema,
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(200).default(50),
                before: z.coerce.number().int().min(0).max(8640000000000000).optional(),
            }),
            response: { 200: z.object({ runs: z.array(TeammateRunSchema) }), ...errorResponses },
        },
    }, async (request, reply) => {
        const runs = await teammateRunList(request.userId, request.params.id, request.query.limit, request.query.before);
        if (!runs) return reply.code(404).send({ error: 'not_found' });
        return { runs };
    });

    app.get('/v1/teammates/:id/tasks', {
        ...common,
        schema: {
            params: IdParamsSchema,
            querystring: z.object({ status: z.enum(['active', 'all']).default('all') }),
            response: { 200: z.object({ tasks: z.array(TeammateTaskSchema) }), ...errorResponses },
        },
    }, async (request, reply) => {
        const tasks = await teammateTaskList(request.userId, request.params.id, request.query.status);
        if (!tasks) return reply.code(404).send({ error: 'not_found' });
        return { tasks };
    });

    app.get('/v1/teammates/:id/spend', {
        ...common,
        schema: { params: IdParamsSchema, response: { 200: z.object({ spend: TeammateSpendSchema }), ...errorResponses } },
    }, async (request, reply) => {
        const spend = await teammateSpendGet(request.userId, request.params.id, new Date());
        if (!spend) return reply.code(404).send({ error: 'not_found' });
        return { spend };
    });

    const RunParamsSchema = z.object({ runId: z.string().min(1) });
    const RunResponseSchema = z.object({ run: TeammateRunSchema });
    app.post('/v1/teammates/:id/runs', {
        ...common,
        schema: { params: IdParamsSchema, body: TeammateManualRunRequestSchema, response: { 200: RunResponseSchema, ...errorResponses } },
    }, async (request) => {
        const teammate = await teammateGet(request.userId, request.params.id);
        if (!teammate) throw new TeammateError('not_found');
        if (teammate.status === 'archived') throw new TeammateError('archived');
        const thread = await teammateThreadEnsure(teammate.id, 'heartbeat');
        const run = await teammateRunEnqueue({ teammateId: teammate.id, threadId: thread.id, trigger: 'manual', event: { type: 'manual', at: Date.now(), data: request.body.note === undefined ? {} : { note: request.body.note } } });
        return { run };
    });
    for (const kind of ['heartbeat', 'dreaming'] as const) {
        app.post(`/v1/teammates/:id/${kind}`, {
            ...common,
            schema: { params: IdParamsSchema, response: { 200: TeammateScheduledRunResponseSchema, ...errorResponses } },
        }, async request => ({ run: await teammateManualScheduledRun(request.userId, request.params.id, kind) }));
    }
    app.post('/v1/teammate-runs/:runId/cancel', {
        ...common,
        schema: { params: RunParamsSchema, response: { 200: RunResponseSchema, ...errorResponses } },
    }, async (request) => ({ run: await teammateRunCancel(request.userId, request.params.runId) }));
    app.post('/v1/teammate-runs/:runId/retry', {
        ...common,
        schema: { params: RunParamsSchema, response: { 200: RunResponseSchema, ...errorResponses } },
    }, async (request) => ({ run: await teammateRunRetry(request.userId, request.params.runId) }));
    app.get('/v1/teammate-runs/:runId', {
        ...common,
        schema: { params: RunParamsSchema, response: { 200: RunResponseSchema, ...errorResponses } },
    }, async (request) => {
        const run = await teammateRunGet(request.userId, request.params.runId);
        if (!run) throw new TeammateError('not_found');
        return { run };
    });
    app.post('/v1/teammate-runs/:runId/started', {
        ...common,
        schema: { params: RunParamsSchema, body: TeammateRunStartedRequestSchema, response: { 200: z.object({ ok: z.literal(true) }), ...errorResponses } },
    }, async (request) => {
        await teammateRunStart(request.params.runId, request.body, request.userId);
        return { ok: true as const };
    });
    app.post('/v1/teammate-runs/:runId/finished', {
        ...common,
        schema: { params: RunParamsSchema, body: TeammateRunFinishedRequestSchema, response: { 200: z.object({ ok: z.literal(true) }), ...errorResponses } },
    }, async (request) => {
        await teammateRunFinish(request.params.runId, request.body, request.userId);
        return { ok: true as const };
    });
    app.post('/v1/teammate-runs/:runId/context-event', {
        ...common,
        schema: { params: RunParamsSchema, body: TeammateContextEventRequestSchema, response: { 200: z.object({ ok: z.literal(true) }), ...errorResponses } },
    }, async (request) => {
        await teammateRunContextEvent(request.params.runId, request.body, request.userId);
        return { ok: true as const };
    });
    app.get('/v1/teammate-runtime/active-sessions', {
        ...common,
        schema: { querystring: z.object({ machineId: z.string().min(1) }), response: { 200: TeammateActiveSessionsResponseSchema, ...errorResponses } },
    }, async (request) => ({ sessionIds: await teammateActiveSessions(request.userId, request.query.machineId) }));
}
