import { createHash, randomUUID } from 'node:crypto';
import { redis } from '@/storage/redis';
import { log } from '@/utils/log';

const channel = 'happy:events:bridge:v1';
const instanceId = randomUUID();
type Presence = { keys: string[]; member: string; pending: Promise<void> };
const sessionPresence = new Map<string, Presence>();
let presenceTimer: NodeJS.Timeout | undefined;
let subscriber: ReturnType<typeof redis.duplicate> | undefined;
let starting: Promise<void> | undefined;
let deliver: ((userId: string, eventName: 'update' | 'ephemeral', payload: unknown,
    recipientFilter: unknown) => void) | undefined;

export function startEventBridge(receiver: typeof deliver): Promise<void> {
    deliver = receiver;
    if (starting) return starting;
    starting = (async () => {
        subscriber = redis.duplicate();
        subscriber.on('message', (_channel, raw) => {
            try {
                const envelope = JSON.parse(raw) as { origin: string; userId: string;
                    eventName: 'update' | 'ephemeral'; payload: unknown; recipientFilter: unknown };
                if (envelope.origin !== instanceId) {
                    deliver?.(envelope.userId, envelope.eventName, envelope.payload,
                        envelope.recipientFilter);
                }
            } catch (error) {
                log({ module: 'event-bridge', level: 'error' }, String(error));
            }
        });
        await subscriber.subscribe(channel);
        presenceTimer = setInterval(() => {
            for (const presence of sessionPresence.values()) {
                presence.pending = presence.pending.catch(() => undefined).then(async () => {
                    for (const key of presence.keys) {
                        await redis.zadd(key, Date.now() + 30_000, presence.member);
                        await redis.expire(key, 60);
                    }
                });
                void presence.pending.catch(error =>
                    log({ module: 'event-bridge', level: 'error' }, String(error)));
            }
        }, 10_000);
        presenceTimer.unref();
    })();
    return starting.catch(error => { starting = undefined; subscriber?.disconnect(); subscriber = undefined; throw error; });
}

function presenceKey(userId: string, sessionId: string, receipt = false): string {
    const digest = createHash('sha256').update(userId).update('\0').update(sessionId).digest('hex');
    return `happy:session:presence:v1:${digest}${receipt ? ':receipt' : ''}`;
}

export async function registerSessionPresence(userId: string, sessionId: string,
    socketId: string, supportsMessageReceipt = false): Promise<void> {
    const keys = [presenceKey(userId, sessionId)];
    if (supportsMessageReceipt) keys.push(presenceKey(userId, sessionId, true));
    const member = `${instanceId}:${socketId}`;
    const presence: Presence = { keys, member, pending: Promise.resolve() };
    sessionPresence.set(socketId, presence);
    presence.pending = (async () => {
        for (const key of keys) {
            await redis.zadd(key, Date.now() + 30_000, member);
            await redis.expire(key, 60);
        }
    })();
    await presence.pending;
}

export async function unregisterSessionPresence(socketId: string): Promise<void> {
    const presence = sessionPresence.get(socketId);
    if (!presence) return;
    sessionPresence.delete(socketId);
    await presence.pending.catch(() => undefined);
    for (const key of presence.keys) await redis.zrem(key, presence.member);
}

async function hasPresence(userId: string, sessionId: string, receipt: boolean): Promise<boolean> {
    const key = presenceKey(userId, sessionId, receipt);
    await redis.zremrangebyscore(key, '-inf', Date.now());
    return (await redis.zcard(key)) > 0;
}

export const hasSessionPresence = (userId: string, sessionId: string) =>
    hasPresence(userId, sessionId, false);
export const hasReceiptSessionPresence = (userId: string, sessionId: string) =>
    hasPresence(userId, sessionId, true);

export function publishEvent(userId: string, eventName: 'update' | 'ephemeral',
    payload: unknown, recipientFilter: unknown): void {
    if (!starting) return;
    try {
        const encoded = JSON.stringify({ origin: instanceId, userId, eventName,
            payload, recipientFilter });
        if (Buffer.byteLength(encoded) > 5_000_000) return;
        void redis.publish(channel, encoded).catch(error =>
            log({ module: 'event-bridge', level: 'error' }, String(error)));
    } catch (error) {
        log({ module: 'event-bridge', level: 'error' }, String(error));
    }
}

export function stopEventBridge(): void {
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = undefined;
    for (const socketId of sessionPresence.keys()) {
        void unregisterSessionPresence(socketId).catch(error =>
            log({ module: 'event-bridge', level: 'error' }, String(error)));
    }
    subscriber?.disconnect();
    subscriber = undefined;
    starting = undefined;
    deliver = undefined;
}
