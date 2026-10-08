import { createHash, randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { log } from '@/utils/log';

type Route = { accountId: string; method: string; instanceId: string; epoch: number; socketId: string };
type Message =
    | { type: 'route'; route: Route | null; accountId: string; method: string }
    | { type: 'request'; id: string; route: Route; params: unknown;
        replyTo: string; deadlineAt: number }
    | { type: 'response'; id: string; response?: unknown; error?: string };

const instanceId = randomUUID();
const channel = 'happy:rpc:bridge:v1';
const inbox = `${channel}:${instanceId}`;
const routes = new Map<string, Route>();
const owned = new Map<string, { route: Route; socket: Socket }>();
const pending = new Map<string, { resolve: (value: unknown) => void;
    reject: (error: Error) => void; deadlineAt: number }>();
let subscriber: Redis | undefined;
let bridgeClient: Redis | undefined;
let initializing: Promise<void> | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

export class RpcBridgeUnavailableError extends Error {
    readonly code = 'AI_RPC_BRIDGE_UNAVAILABLE';
    readonly statusCode = 503;
    constructor(message = 'RPC bridge unavailable') { super(message); }
}

function redis(): Redis {
    if (!bridgeClient) bridgeClient = new Redis(process.env.REDIS_URL!, {
        enableOfflineQueue: false, commandTimeout: 600,
        connectTimeout: 750, maxRetriesPerRequest: 1,
    });
    return bridgeClient;
}
function timeLeft(deadlineAt: number): number {
    if (!Number.isFinite(deadlineAt) && deadlineAt !== Number.POSITIVE_INFINITY) {
        throw new RpcBridgeUnavailableError();
    }
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new RpcBridgeUnavailableError();
    return remaining;
}
async function waitReady(client: Redis): Promise<void> {
    if (client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new RpcBridgeUnavailableError()); }, 750);
        const cleanup = () => {
            clearTimeout(timer);
            client.off('ready', ready);
            client.off('end', ended);
        };
        const ready = () => { cleanup(); resolve(); };
        const ended = () => { cleanup(); reject(new RpcBridgeUnavailableError()); };
        client.once('ready', ready);
        client.once('end', ended);
        if (client.status === 'ready') ready();
    });
}

function id(accountId: string, method: string): string {
    return createHash('sha256').update(accountId).update('\0').update(method).digest('hex');
}
function key(accountId: string, method: string): string { return `happy:rpc:route:v1:${id(accountId, method)}`; }
function same(a: Route | null | undefined, b: Route): boolean {
    return !!a && a.instanceId === b.instanceId && a.epoch === b.epoch && a.socketId === b.socketId;
}
function parse(value: string | null): Route | null {
    if (!value) return null;
    try {
        const row = JSON.parse(value) as Route;
        return row.accountId && row.method && row.instanceId && Number.isSafeInteger(row.epoch) ? row : null;
    } catch { return null; }
}
async function read(accountId: string, method: string): Promise<Route | null> {
    try { return parse(await redis().get(key(accountId, method))); }
    catch { throw new RpcBridgeUnavailableError(); }
}
async function refresh(): Promise<void> {
    let cursor = '0';
    const next = new Map<string, Route>();
    do {
        const [after, keys] = await redis().scan(cursor, 'MATCH', 'happy:rpc:route:v1:*', 'COUNT', 100);
        cursor = after;
        if (keys.length) {
            const values = await redis().mget(...keys);
            for (const value of values) {
                const route = parse(value);
                if (route) next.set(id(route.accountId, route.method), route);
            }
        }
    } while (cursor !== '0');
    routes.clear();
    for (const [routeId, route] of next) routes.set(routeId, route);
}

export async function startRpcBridge(): Promise<void> {
    if (initializing) return initializing;
    initializing = (async () => {
        await waitReady(redis());
        subscriber = redis().duplicate();
        await waitReady(subscriber);
        subscriber.on('message', (receivedChannel, raw) => {
            void (async () => {
                const message = JSON.parse(raw) as Message;
                if (message.type === 'route') {
                    const routeId = id(message.accountId, message.method);
                    const current = routes.get(routeId);
                    if (message.route) {
                        if (!current || message.route.epoch >= current.epoch) routes.set(routeId, message.route);
                    } else if (!current || !(await read(message.accountId, message.method))) routes.delete(routeId);
                    return;
                }
                if (message.type === 'response') {
                    const waiter = pending.get(message.id);
                    if (waiter) {
                        pending.delete(message.id);
                        if (Date.now() >= waiter.deadlineAt) waiter.reject(new RpcBridgeUnavailableError());
                        else message.error ? waiter.reject(new RpcBridgeUnavailableError(
                            message.error === 'RPC owner changed' ? 'RPC owner changed'
                                : 'RPC request failed')) : waiter.resolve(message.response);
                    }
                    return;
                }
                if (message.type !== 'request' || receivedChannel !== inbox) return;
                if (timeLeft(message.deadlineAt) <= 0) return;
                const owner = owned.get(id(message.route.accountId, message.route.method));
                const current = await read(message.route.accountId, message.route.method);
                if (!owner || !same(owner.route, message.route) || !same(current, message.route)
                    || !owner.socket.connected) return;
                let response: Message;
                try {
                    const result = await owner.socket.timeout(Math.min(15_000,
                        timeLeft(message.deadlineAt))).emitWithAck('rpc-request', {
                        method: message.route.method, params: message.params,
                    });
                    response = timeLeft(message.deadlineAt) > 0
                        && same(await read(message.route.accountId, message.route.method), message.route)
                        ? { type: 'response', id: message.id, response: result }
                        : { type: 'response', id: message.id, error: 'RPC owner changed' };
                } catch {
                    response = { type: 'response', id: message.id, error: 'RPC request failed' };
                }
                if (Date.now() < message.deadlineAt) {
                    await redis().publish(message.replyTo, JSON.stringify(response));
                }
            })().catch(() => log({ module: 'rpc-bridge', level: 'error' }, 'RPC bridge request failed'));
        });
        await subscriber.subscribe(channel, inbox);
        await refresh();
        refreshTimer = setInterval(() => {
            void (async () => {
                for (const { route, socket } of owned.values()) {
                    if (!socket.connected) continue;
                    await redis().eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],30000) else return 0 end",
                        1, key(route.accountId, route.method), JSON.stringify(route));
                }
                await refresh();
            })().catch(error => log({ module: 'rpc-bridge', level: 'error' }, String(error)));
        }, 10_000);
        refreshTimer.unref();
    })();
    try { await initializing; } catch (error) { initializing = undefined; subscriber?.disconnect(); subscriber = undefined; throw error; }
}

export async function registerRpcRoute(accountId: string, method: string, socket: Socket): Promise<void> {
    await startRpcBridge();
    if (!socket.connected) throw new Error('RPC socket disconnected');
    const routeId = id(accountId, method);
    const epoch = await redis().incr(`happy:rpc:epoch:v1:${routeId}`);
    const route: Route = { accountId, method, instanceId, epoch, socketId: socket.id };
    if (!socket.connected) throw new Error('RPC socket disconnected');
    const installed = await redis().eval(
        "local old=redis.call('GET',KEYS[1]); if old and cjson.decode(old).epoch >= tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'PX',30000); return 1",
        1, key(accountId, method), epoch, JSON.stringify(route));
    if (installed !== 1 || !socket.connected) {
        if (installed === 1) await removeRoute(route);
        throw new Error('RPC registration superseded');
    }
    owned.set(routeId, { route, socket });
    routes.set(routeId, route);
    await redis().publish(channel, JSON.stringify({ type: 'route', route, accountId, method }));
}

async function removeRoute(route: Route): Promise<void> {
    const removed = await redis().eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1, key(route.accountId, route.method), JSON.stringify(route));
    if (removed === 1) {
        routes.delete(id(route.accountId, route.method));
        await redis().publish(channel, JSON.stringify({ type: 'route', route: null,
            accountId: route.accountId, method: route.method }));
    }
}
export async function unregisterRpcRoute(accountId: string, method: string, socket: Socket): Promise<void> {
    const routeId = id(accountId, method);
    const owner = owned.get(routeId);
    if (!owner || owner.socket !== socket) return;
    owned.delete(routeId);
    await removeRoute(owner.route);
}
export function cachedRpcMethods(accountId: string): string[] {
    return [...routes.values()].filter(route => route.accountId === accountId).map(route => route.method);
}
export async function assertLocalRpcOwner(accountId: string, method: string, socket: Socket,
    deadlineAt = Number.POSITIVE_INFINITY): Promise<void> {
    if (!initializing) return;
    const owner = owned.get(id(accountId, method));
    if (!owner || owner.socket !== socket || !same(await read(accountId, method), owner.route)) {
        throw new RpcBridgeUnavailableError('RPC owner changed');
    }
    timeLeft(deadlineAt);
}
export async function invokeRemoteRpc(accountId: string, method: string, params: unknown,
    timeoutMs: number, deadlineAt = Date.now() + timeoutMs): Promise<unknown> {
    try { await startRpcBridge(); } catch { throw new RpcBridgeUnavailableError(); }
    timeLeft(deadlineAt);
    const route = await read(accountId, method);
    timeLeft(deadlineAt);
    if (!route) throw new RpcBridgeUnavailableError(`RPC method not available: ${method}`);
    if (route.instanceId === instanceId) throw new RpcBridgeUnavailableError('Local RPC route unavailable');
    const requestId = randomUUID();
    const remaining = timeLeft(deadlineAt);
    const response = new Promise<unknown>((resolve, reject) => {
        pending.set(requestId, { resolve, reject, deadlineAt });
    });
    void response.catch(() => {});
    const timer = setTimeout(() => {
        pending.get(requestId)?.reject(new RpcBridgeUnavailableError());
        pending.delete(requestId);
    }, remaining);
    try {
        try {
            await redis().publish(`${channel}:${route.instanceId}`, JSON.stringify({ type: 'request',
                id: requestId, route, params, replyTo: inbox, deadlineAt }));
        } catch {
            // A timed-out write may still be buffered by TCP. Keep the request
            // pending until its shared deadline so a late publish cannot run
            // after this call has already reported failure.
        }
        const result = await response;
        timeLeft(deadlineAt);
        if (!same(await read(accountId, method), route)) throw new RpcBridgeUnavailableError('RPC owner changed');
        timeLeft(deadlineAt);
        return result;
    } finally { clearTimeout(timer); pending.delete(requestId); }
}

export async function stopRpcBridge(): Promise<void> {
    if (refreshTimer) clearInterval(refreshTimer);
    for (const { route } of owned.values()) await removeRoute(route);
    owned.clear();
    for (const waiter of pending.values()) waiter.reject(new Error('RPC bridge stopped'));
    pending.clear();
    subscriber?.disconnect();
    subscriber = undefined;
    bridgeClient?.disconnect();
    bridgeClient = undefined;
    initializing = undefined;
}
