import { z } from 'zod';
import {
    TeammateTaskSchema, TeammateTaskDetailSchema, TeammateTaskDelegateRequestSchema,
    TeammateTaskAgentUpdateRequestSchema, TeammateTaskCommentRequestSchema, TeammateTaskCommentResponseSchema,
    TeammateSessionRegisterRequestSchema, GithubIssueResourceIdSchema,
    TeammateTaskCreateRequestSchema, TeammateTaskCreateResponseSchema,
} from 'happy-wire';
import type { Fastify } from '../types';
import { TeammateError } from '@/app/teammate/teammateError';
import { teammateTaskDelegate } from '@/app/teammate/teammateTaskDelegate';
import { teammateTaskAgentUpdate } from '@/app/teammate/teammateTaskAgentUpdate';
import { teammateTaskComment } from '@/app/teammate/teammateTaskComment';
import { teammateSessionRegister } from '@/app/teammate/teammateSessionRegister';
import { teammateTaskStop } from '@/app/teammate/teammateTaskStop';
import { teammateTaskResume } from '@/app/teammate/teammateTaskResume';
import { teammateTaskCancel } from '@/app/teammate/teammateTaskCancel';
import { teammateTaskListByResource, teammateTaskDetail } from '@/app/teammate/teammateTaskQueries';
import { teammateTaskCreate } from '@/app/teammate/teammateTaskCreate';

const ErrorSchema = z.object({ error: z.string() });
const errors = { 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 429: ErrorSchema };
const ParamsSchema = z.object({ id: z.string().min(1) });
const TaskResponseSchema = z.object({ task: TeammateTaskSchema });

/** Register account-authenticated task lifecycle, issue comments and daemon worker registration endpoints. */
export function teammateTaskRoutes(app: Fastify) {
    const common = {
        preHandler: app.authenticate,
        errorHandler: ((error, _request, reply) => {
            if (error instanceof TeammateError) {
                const status = ['not_found', 'issue_not_found'].includes(error.code) ? 404 : ['invalid_token', 'run_expired', 'self_assign_disabled', 'repo_not_allowed'].includes(error.code) ? 403 : error.code === 'task_create_limit' ? 429 : error.code === 'invalid_request' ? 400 : 409;
                return reply.code(status).send({ error: error.code });
            }
            if (error.validation || error.statusCode === 400 || error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
            return reply.send(error);
        }) satisfies NonNullable<Parameters<Fastify['route']>[0]['errorHandler']>,
    };
    app.post('/v1/teammate-tasks', { ...common, schema: { body: TeammateTaskDelegateRequestSchema, response: { 200: TaskResponseSchema, ...errors } } }, async request => ({ task: await teammateTaskDelegate(request.userId, request.body) }));
    app.post('/v1/teammate-agent-tasks', { ...common, schema: { body: TeammateTaskCreateRequestSchema, response: { 200: TeammateTaskCreateResponseSchema, ...errors } } }, async request => teammateTaskCreate(request.userId, request.body));
    app.get('/v1/teammate-tasks', { ...common, schema: { querystring: z.object({ resourceId: GithubIssueResourceIdSchema }), response: { 200: z.object({ tasks: z.array(TeammateTaskSchema) }), ...errors } } }, async request => ({ tasks: await teammateTaskListByResource(request.userId, request.query.resourceId) }));
    app.get('/v1/teammate-tasks/:id', { ...common, schema: { params: ParamsSchema, response: { 200: TeammateTaskDetailSchema, ...errors } } }, async request => teammateTaskDetail(request.userId, request.params.id));
    for (const [action, handler] of [['stop', teammateTaskStop], ['resume', teammateTaskResume], ['cancel', teammateTaskCancel]] as const) {
        app.post(`/v1/teammate-tasks/:id/${action}`, { ...common, schema: { params: ParamsSchema, response: { 200: TaskResponseSchema, ...errors } } }, async request => ({ task: await handler(request.userId, request.params.id) }));
    }
    app.post('/v1/teammate-task-updates', { ...common, schema: { body: TeammateTaskAgentUpdateRequestSchema, response: { 200: TaskResponseSchema, ...errors } } }, async request => ({ task: await teammateTaskAgentUpdate(request.userId, request.body) }));
    app.post('/v1/teammate-task-comments', { ...common, schema: { body: TeammateTaskCommentRequestSchema, response: { 200: TeammateTaskCommentResponseSchema, ...errors } } }, async request => teammateTaskComment(request.userId, request.body));
    app.post('/v1/teammate-sessions', { ...common, schema: { body: TeammateSessionRegisterRequestSchema, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
        await teammateSessionRegister(request.userId, request.body); return { ok: true as const };
    });
}
