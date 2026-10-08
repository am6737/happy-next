import type { Socket } from "socket.io";
import { assertLocalRpcOwner, cachedRpcMethods, invokeRemoteRpc, registerRpcRoute, startRpcBridge, stopRpcBridge,
    unregisterRpcRoute, RpcBridgeUnavailableError } from './rpcBridge';

const rpcListenersByUser = new Map<string, Map<string, Socket>>();
let distributed = false;

export function enableDistributedRpc(): void {
    distributed = true;
    void startRpcBridge().catch(() => { /* invoke/register surfaces Redis failure */ });
}
export async function stopDistributedRpc(): Promise<void> {
    distributed = false;
    await stopRpcBridge();
}

export async function registerUserRpcSocket(userId: string, method: string, socket: Socket): Promise<void> {
    if (distributed) await registerRpcRoute(userId, method, socket);
    getOrCreateUserRpcListeners(userId).set(method, socket);
}

export async function unregisterUserRpcSocket(userId: string, method: string, socket: Socket): Promise<void> {
    const listeners = rpcListenersByUser.get(userId);
    if (listeners?.get(method) !== socket) return;
    listeners.delete(method);
    if (!listeners.size) rpcListenersByUser.delete(userId);
    if (distributed) await unregisterRpcRoute(userId, method, socket);
}

export function getOrCreateUserRpcListeners(userId: string): Map<string, Socket> {
    let listeners = rpcListenersByUser.get(userId);
    if (!listeners) {
        listeners = new Map<string, Socket>();
        rpcListenersByUser.set(userId, listeners);
    }
    return listeners;
}

export async function cleanupUserRpcSocket(userId: string, socket: Socket) {
    const listeners = rpcListenersByUser.get(userId);
    if (!listeners) {
        return;
    }

    for (const [method, registeredSocket] of listeners.entries()) {
        if (registeredSocket === socket) {
            await unregisterUserRpcSocket(userId, method, socket);
        }
    }

    if (listeners.size === 0) {
        rpcListenersByUser.delete(userId);
    }
}

export async function invokeUserRpc(
    userId: string,
    method: string,
    params: any,
    timeoutMs: number = 30000
) {
    const deadlineAt = Date.now() + timeoutMs;
    const listeners = rpcListenersByUser.get(userId);
    const targetSocket = listeners?.get(method);
    if (!targetSocket || !targetSocket.connected) {
        if (distributed) return invokeRemoteRpc(userId, method, params, timeoutMs, deadlineAt);
        throw new RpcBridgeUnavailableError(`RPC method not available: ${method}`);
    }

    if (distributed) {
        try { await assertLocalRpcOwner(userId, method, targetSocket, deadlineAt); }
        catch { return invokeRemoteRpc(userId, method, params, timeoutMs, deadlineAt); }
    }
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new RpcBridgeUnavailableError('RPC request timed out');
    let response: any;
    try {
        response = await targetSocket.timeout(remaining).emitWithAck('rpc-request', {
            method,
            params,
        });
    } catch { throw new RpcBridgeUnavailableError('RPC request timed out'); }
    if (distributed) await assertLocalRpcOwner(userId, method, targetSocket, deadlineAt);
    return response;
}

export async function assertUserRpcSocketOwner(userId: string, method: string,
    socket: Socket): Promise<void> {
    if (distributed) await assertLocalRpcOwner(userId, method, socket);
}

export function hasUserRpcMethod(userId: string, method: string): boolean {
    const listeners = rpcListenersByUser.get(userId);
    const targetSocket = listeners?.get(method);
    return !!targetSocket?.connected || (distributed && cachedRpcMethods(userId).includes(method));
}

export function listConnectedUserRpcMethods(userId: string): string[] {
    const listeners = rpcListenersByUser.get(userId);
    const methods: string[] = [];
    for (const [method, socket] of listeners?.entries() ?? []) {
        if (socket.connected) {
            methods.push(method);
        }
    }
    if (distributed) methods.push(...cachedRpcMethods(userId));
    return [...new Set(methods)];
}
