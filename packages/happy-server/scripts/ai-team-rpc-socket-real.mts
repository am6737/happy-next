import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { db } from '../sources/storage/db';
import { redis } from '../sources/storage/redis';
import { auth } from '../sources/app/auth/auth';
import { startSocket } from '../sources/app/api/socket';
import { invokeUserRpc, stopDistributedRpc } from '../sources/app/api/socket/rpcRegistry';
import { eventRouter } from '../sources/app/events/eventRouter';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client') as typeof import('socket.io-client');
const tag = randomUUID();
const app = Fastify({ logger: false });
let accountId: string | undefined;
const clients: Array<ReturnType<typeof io>> = [];
try {
    accountId = (await db.account.create({ data: { publicKey: `rpc-socket-${tag}` } })).id;
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId,
        metadata: '{}', active: true } });
    await auth.init();
    const token = await auth.createToken(accountId);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    startSocket(app as any);
    const connect = async (clientType: string, claimedMachine?: string) => {
        const socket = io(address, { path: '/v1/updates', transports: ['websocket'],
            reconnection: false, auth: { token, clientType,
                ...(claimedMachine ? { machineId: claimedMachine } : {}) } });
        clients.push(socket);
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
            socket.once('connect', () => { clearTimeout(timeout); resolve(); });
            socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
        });
        return socket;
    };
    const register = async (socket: ReturnType<typeof io>, method: string) => {
        const result = new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('RPC registration timed out')), 5000);
            socket.once('rpc-registered', () => { clearTimeout(timeout); resolve('registered'); });
            socket.once('rpc-error', () => { clearTimeout(timeout); resolve('rejected'); });
        });
        socket.emit('rpc-register', { method });
        return result;
    };
    const method = `${machineId}:orchestrator-dispatch`;
    const first = await connect('machine-scoped', machineId);
    first.on('rpc-request', (_request, ack) => ack({ owner: 'first' }));
    assert.equal(await register(first, method), 'registered');
    assert.deepEqual(await invokeUserRpc(accountId, method, {}, 2000), { owner: 'first' });
    const user = await connect('user-scoped');
    user.on('rpc-request', (_request, ack) => ack({ fixtureHijack: true }));
    assert.equal(await register(user, method), 'rejected');
    assert.deepEqual(await invokeUserRpc(accountId, method, {}, 2000), { owner: 'first' });
    const second = await connect('machine-scoped', machineId);
    second.on('rpc-request', (_request, ack) => ack({ owner: 'second' }));
    assert.equal(await register(second, method), 'registered');
    assert.deepEqual(await invokeUserRpc(accountId, method, {}, 2000), { owner: 'second' });
    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await invokeUserRpc(accountId, method, {}, 2000), { owner: 'second' });
    await assert.rejects(connect('machine-scoped', randomUUID()),
        /Machine is unavailable/);
    assert.deepEqual(await invokeUserRpc(accountId, method, {}, 2000), { owner: 'second' });
    console.log('REAL_SOCKET_MACHINE_RPC_IDENTITY_RECONNECT_AND_HIJACK_REJECTION_OK');
} finally {
    for (const client of clients) client.disconnect();
    await app.close();
    await stopDistributedRpc();
    eventRouter.stopDistributed();
    if (accountId) {
        await db.machine.deleteMany({ where: { accountId } });
        await db.account.deleteMany({ where: { id: accountId,
            publicKey: `rpc-socket-${tag}` } });
    }
    await db.$disconnect();
    await redis.quit();
    // The server is imported through the TS path alias, which can load a second
    // Redis module instance under tsx. A fixture must close both clients.
    const aliasedRedis = (await import('@/storage/redis')).redis;
    if (aliasedRedis !== redis) await aliasedRedis.quit();
}
process.exit(0);
