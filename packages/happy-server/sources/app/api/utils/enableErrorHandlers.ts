import { log } from "@/utils/log";
import { Fastify } from "../types";
import { FastifyError } from "fastify";

export function enableErrorHandlers(app: Fastify) {
    // Global error handler
    app.setErrorHandler(async (error: FastifyError, request, reply) => {
        const method = request.method;
        const url = request.url;
        const userAgent = request.headers['user-agent'] || 'unknown';
        const ip = request.ip || 'unknown';
        const statusCode = error.statusCode || 500;

        // Client errors (4xx) — e.g. request validation failures — are expected and
        // often high-volume; log them at warn without a stack trace to cut noise.
        // Only server errors (5xx) are genuine faults worth an error-level stack.
        const isClientError = statusCode >= 400 && statusCode < 500;

        log({
            module: 'fastify-error',
            level: isClientError ? 'warn' : 'error',
            method,
            url,
            userAgent,
            ip,
            statusCode,
            errorCode: error.code,
            ...(isClientError ? {} : { stack: error.stack }),
        }, `${isClientError ? 'Client' : 'Unhandled'} error: ${error.message}`);

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
        log({ module: '404-handler' }, `404 - Method: ${request.method}, Path: ${request.url}, Headers: ${JSON.stringify(request.headers)}`);
        reply.code(404).send({ error: 'Not found', path: request.url, method: request.method });
    });

    // Error hook for additional logging
    app.addHook('onError', async (request, reply, error) => {
        const method = request.method;
        const url = request.url;
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        const statusCode = reply.statusCode || error.statusCode || 500;
        const isClientError = statusCode >= 400 && statusCode < 500;

        log({
            module: 'fastify-hook-error',
            level: isClientError ? 'warn' : 'error',
            method,
            url,
            duration,
            statusCode,
            errorName: error.name,
            errorCode: error.code
        }, `Request error: ${error.message}`);
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
                    url: request.url,
                    stack: error.stack
                }, `Response serialization error: ${error.message}`);
                throw error;
            }
        };
    });
}