import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { enableErrorHandlers } from './enableErrorHandlers';
import { RpcBridgeUnavailableError } from '../socket/rpcBridge';

describe('database capacity error handling', () => {
    it('returns a bounded retry for pool exhaustion without exposing the database error', async () => {
        const app = Fastify();
        enableErrorHandlers(app as any);
        app.get('/saturated', async () => {
            const error = new Error('FATAL: too many connections for role private-role');
            error.name = 'PrismaClientInitializationError';
            throw error;
        });
        const reply = await app.inject('/saturated');
        expect(reply.statusCode).toBe(503);
        expect(reply.headers['retry-after']).toBe('2');
        expect(reply.json()).toEqual({ errorCode: 'AI_DB_CAPACITY' });
        expect(reply.body).not.toContain('private-role');
        await app.close();
    });

    it('keeps unrelated failures as 500', async () => {
        const app = Fastify();
        enableErrorHandlers(app as any);
        app.get('/broken', async () => { throw new Error('unexpected private data'); });
        const reply = await app.inject('/broken');
        expect(reply.statusCode).toBe(500);
        expect(reply.headers['retry-after']).toBeUndefined();
        expect(reply.body).not.toContain('unexpected private data');
        await app.close();
    });

    it('returns a bounded retry for a Redis RPC bridge outage', async () => {
        const app = Fastify();
        enableErrorHandlers(app as any);
        app.get('/rpc-outage', async () => { throw new RpcBridgeUnavailableError(); });
        const reply = await app.inject('/rpc-outage');
        expect(reply.statusCode).toBe(503);
        expect(reply.headers['retry-after']).toBe('2');
        expect(reply.json()).toEqual({ errorCode: 'AI_RPC_BRIDGE_UNAVAILABLE' });
        await app.close();
    });
});
