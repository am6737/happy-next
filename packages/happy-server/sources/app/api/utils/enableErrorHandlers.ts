import { log } from "@/utils/log";
import { Fastify } from "../types";
import { FastifyError } from "fastify";
import { isAiDbCapacityError, recordAiDbPoolRejection } from '@/app/ai/dbCapacity';
import { RpcBridgeUnavailableError } from '../socket/rpcBridge';

export function enableErrorHandlers(app: Fastify) {
    // Global error handler
    app.setErrorHandler(async (error: FastifyError, request, reply) => {
        const method = request.method;
        const route = request.routeOptions.url || 'unmatched';
        if (isAiDbCapacityError(error)) {
            recordAiDbPoolRejection();
            return reply.header('Retry-After', '2').code(503).send({
                errorCode: 'AI_DB_CAPACITY',
            });
        }
        if (error instanceof RpcBridgeUnavailableError) {
            return reply.header('Retry-After', '2').code(503).send({
                errorCode: 'AI_RPC_BRIDGE_UNAVAILABLE',
            });
        }
        const statusCode = error.statusCode || 500;

        // Client errors (4xx) — e.g. request validation failures — are expected and
        // often high-volume; log them at warn without a stack trace to cut noise.
        // Only server errors (5xx) are genuine faults worth an error-level stack.
        const isClientError = statusCode >= 400 && statusCode < 500;

        log({
            module: 'fastify-error',
            level: isClientError ? 'warn' : 'error',
            method,
            route,
            statusCode,
            errorCode: error.code,
        }, `${isClientError ? 'Client request rejected' : 'Unhandled request error'}`);

        if (statusCode >= 500) {
            // Internal server errors - don't expose details
            return reply.code(statusCode).send({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred',
                statusCode
            });
        } else {
            // Client errors - can expose more details
            return reply.code(statusCode).send({
                error: error.name || 'Error',
                message: error.message || 'An error occurred',
                statusCode
            });
        }
    });

    // Catch-all route for debugging 404s
    app.setNotFoundHandler((request, reply) => {
        log({ module: '404-handler', method: request.method }, 'Route not found');
        reply.code(404).send({ error: 'Not found' });
    });

    // Error hook for additional logging
    app.addHook('onError', async (request, reply, error) => {
        const method = request.method;
        const route = request.routeOptions.url || 'unmatched';
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        // Prefer error.statusCode: when this hook fires for validation errors the
        // reply code hasn't been set yet, so reply.statusCode is still the default 200.
        const statusCode = isAiDbCapacityError(error)
            || error instanceof RpcBridgeUnavailableError ? 503
            : error.statusCode || (reply.statusCode >= 400 ? reply.statusCode : 500);
        const isClientError = statusCode >= 400 && statusCode < 500;

        log({
            module: 'fastify-hook-error',
            level: isClientError ? 'warn' : 'error',
            method,
            route,
            duration,
            statusCode,
            errorName: error.name,
            errorCode: error.code
        }, 'Request error');
    });

    // Handle uncaught exceptions in routes
    app.addHook('preHandler', async (request, reply) => {
        // Store original reply.send to catch errors in response serialization
        const originalSend = reply.send.bind(reply);
        reply.send = function (payload: any) {
            try {
                return originalSend(payload);
            } catch (error: any) {
                log({
                    module: 'fastify-serialization-error',
                    level: 'error',
                    method: request.method,
                    route: request.routeOptions.url || 'unmatched',
                }, 'Response serialization error');
                throw error;
            }
        };
    });
}
