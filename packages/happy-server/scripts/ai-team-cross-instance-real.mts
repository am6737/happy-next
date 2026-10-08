import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { db } from '../sources/storage/db';
import { redis } from '../sources/storage/redis';
import { auth } from '../sources/app/auth/auth';
import { startSocket } from '../sources/app/api/socket';
import { invokeUserRpc, listConnectedUserRpcMethods } from '../sources/app/api/socket/rpcRegistry';
import { eventRouter } from '../sources/app/events/eventRouter';
import { hasReceiptSessionPresence, hasSessionPresence } from '../sources/app/events/eventBridge';
import { executeSchedulerActions, type SchedulerAction } from '../sources/app/orchestrator/scheduler';
import { dispatchSessionMessage } from '../sources/app/session/sessionMessageDispatch';
import { requestStructuredModel } from '../sources/app/ai/modelGateway';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client') as typeof import('socket.io-client');
const portA = 43115;
const portB = 43117;
const marker = randomUUID();

if (process.argv.includes('--server')) {
    await auth.init();
    const app = Fastify({ logger: false });
    app.get('/health', async () => ({ ok: true }));
    app.post<{ Body: { accountId: string; method: string } }>('/invoke', async request => ({
        response: await invokeUserRpc(request.body.accountId, request.body.method,
            { marker }, 3000),
    }));
    app.post<{ Body: { accountId: string; marker: string } }>('/emit', async request => {
        eventRouter.emitEphemeral({ userId: request.body.accountId,
            payload: { type: 'machine-activity', marker: request.body.marker } });
        return { ok: true };
    });
    app.get<{ Querystring: { accountId: string } }>('/methods', async request => ({
        methods: listConnectedUserRpcMethods(request.query.accountId),
    }));
    app.get<{ Querystring: { accountId: string; sessionId: string } }>('/presence', async request => ({
        online: await hasSessionPresence(request.query.accountId, request.query.sessionId),
        receipt: await hasReceiptSessionPresence(request.query.accountId, request.query.sessionId),
    }));
    app.post<{ Body: { accountId: string; sessionId: string; localId: string } }>('/message',
        async request => dispatchSessionMessage({ ownerId: request.body.accountId,
            sessionId: request.body.sessionId, localId: request.body.localId,
            content: 'owned-cross-instance-fixture', sentBy: null,
            sentByName: null, trackCliDelivery: true }));
    app.post<{ Body: { accountId: string } }>('/model', async request => ({
        result: await requestStructuredModel({ accountId: request.body.accountId,
            prompt: 'Owned cross-instance model fixture',
            schema: z.object({ answer: z.literal('from-machine-A') }) }),
    }));
    app.post<{ Body: Extract<SchedulerAction, { type: 'cancel' }> }>('/cancel',
        async request => {
            await executeSchedulerActions([request.body]);
            return { ok: true };
        });
    app.post<{ Body: SchedulerAction }>('/dispatch', async request => {
        await executeSchedulerActions([request.body]);
        const execution = await db.orchestratorExecution.findUniqueOrThrow({ where: {
            id: request.body.executionId }, select: { status: true,
            capabilityProtocolVersion: true, capabilityAllowedOps: true } });
        return execution;
    });
    startSocket(app as any);
    await app.listen({ host: '127.0.0.1', port: Number(process.argv.at(-1)) });
} else {
    let accountId: string | undefined;
    let otherAccountId: string | undefined;
    let fixtureMachineId: string | undefined;
    let runId: string | undefined;
    let agentId: string | undefined;
    let conversationId: string | undefined;
    let sessionId: string | undefined;
    const children: ChildProcess[] = [];
    const sockets: Array<ReturnType<typeof io>> = [];
    const api = async (port: number, path: string, body?: object) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, body ? {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        } : undefined);
        if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
        return response.json() as Promise<any>;
    };
    const eventually = async (check: () => Promise<boolean>) => {
        for (let attempt = 0; attempt < 80; attempt++) {
            try { if (await check()) return; } catch { /* server still starting */ }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Cross-instance condition timed out');
    };
    try {
        accountId = (await db.account.create({ data: { publicKey: `rpc-cross-${marker}` } })).id;
        otherAccountId = (await db.account.create({ data: {
            publicKey: `rpc-cross-other-${marker}` } })).id;
        const machineId = randomUUID();
        fixtureMachineId = machineId;
        await db.machine.create({ data: { id: machineId, accountId, metadata: '{}' } });
        await auth.init();
        const token = await auth.createToken(accountId);
        for (const port of [portA, portB]) {
            const child = spawn(process.execPath, [require.resolve('tsx/cli'), '--tsconfig',
                'tsconfig.json', 'scripts/ai-team-cross-instance-real.mts', '--server', String(port)], {
                cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: '' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            child.stdout?.on('data', () => undefined);
            child.stderr?.on('data', data => process.stderr.write(data));
            children.push(child);
            await eventually(async () => (await api(port, '/health')).ok);
        }
        const connect = async (port: number, type: string) => {
            const socket = io(`http://127.0.0.1:${port}`, { path: '/v1/updates',
                transports: ['websocket'], reconnection: false,
                auth: { token, clientType: type, ...(type === 'machine-scoped' ? { machineId } : {}) } });
            sockets.push(socket);
            await new Promise<void>((resolve, reject) => {
                socket.once('connect', resolve); socket.once('connect_error', reject);
                setTimeout(() => reject(new Error('Socket timeout')), 5000).unref();
            });
            return socket;
        };
        const register = async (socket: ReturnType<typeof io>, method: string) => {
            const ack = new Promise<void>((resolve, reject) => {
                socket.once('rpc-registered', () => resolve());
                socket.once('rpc-error', reject);
                setTimeout(() => reject(new Error('Register timeout')), 5000).unref();
            });
            socket.emit('rpc-register', { method });
            await ack;
        };
        const method = `${machineId}:orchestrator-dispatch`;
        const featureMethod = `${machineId}:orchestrator-features`;
        let dispatchedCapability: any;
        let dispatchCalls = 0;
        let cancelCalls = 0;
        const machineA = await connect(portA, 'machine-scoped');
        machineA.on('rpc-request', (message, ack) => {
            if (message.method === featureMethod) return ack({ nonce: message.params.nonce,
                machineId, protocolVersion: 1, executionCapabilityVersion: 1,
                approval: { provider: 'codex', runner: 'app-server', operationDecisionVersion: 1 } });
            if (message.method === `${machineId}:ai-structured-model`) return ack({
                success: true, text: '{"answer":"from-machine-A"}',
            });
            if (message.method === `${machineId}:orchestrator-cancel`) cancelCalls++;
            if (message.method === method) {
                dispatchCalls++;
                dispatchedCapability = message.params.executionCapability;
            }
            ack({ owner: 'A' });
        });
        await register(machineA, method);
        await register(machineA, featureMethod);
        const crashMethod = `${machineId}:ai-structured-model`;
        const cancelMethod = `${machineId}:orchestrator-cancel`;
        await register(machineA, crashMethod);
        await register(machineA, cancelMethod);
        const routeId = createHash('sha256').update(accountId).update('\0').update(method).digest('hex');
        const routeRaw = await redis.get(`happy:rpc:route:v1:${routeId}`);
        assert.ok(routeRaw);
        const currentRoute = JSON.parse(routeRaw) as { instanceId: string };
        const beforeExpired = dispatchCalls;
        await redis.publish(`happy:rpc:bridge:v1:${currentRoute.instanceId}`,
            JSON.stringify({ type: 'request', id: randomUUID(), route: JSON.parse(routeRaw),
                params: { ownedFixture: marker }, replyTo: `happy:rpc:bridge:v1:expired-${marker}`,
                deadlineAt: Date.now() - 1 }));
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(dispatchCalls, beforeExpired);
        console.log('REAL_EXPIRED_BRIDGE_REQUEST_NO_MACHINE_SIDE_EFFECT_OK');
        await eventually(async () => (await api(portB, `/methods?accountId=${accountId}`)).methods.includes(method));
        assert.deepEqual((await api(portB, '/invoke', { accountId, method })).response, { owner: 'A' });
        assert.deepEqual((await api(portB, '/invoke', { accountId,
            method: crashMethod })).response, {
                success: true, text: '{"answer":"from-machine-A"}',
            });
        assert.deepEqual((await api(portB, '/invoke', { accountId,
            method: cancelMethod })).response, { owner: 'A' });
        assert.deepEqual((await api(portB, '/model', { accountId })).result,
            { answer: 'from-machine-A' });
        await assert.rejects(api(portB, '/model', { accountId: otherAccountId }));
        const cancelBefore = cancelCalls;
        await api(portB, '/cancel', { type: 'cancel', accountId, machineId,
            runId: marker, taskId: marker, executionId: marker,
            dispatchToken: marker, payload: { runId: marker, taskId: marker,
                executionId: marker, dispatchToken: marker } });
        assert.equal(cancelCalls, cancelBefore + 1);
        console.log('REAL_TWO_PROCESS_MODEL_AND_CANCEL_RPC_OK');
        await assert.rejects(api(portB, '/invoke', { accountId: otherAccountId, method }));
        const userA = await connect(portA, 'user-scoped');
        const userB = await connect(portB, 'user-scoped');
        const session = await db.session.create({ data: { accountId,
            tag: `rpc-cross-${marker}`, metadata: '{}' } });
        sessionId = session.id;
        const sessionSocket = io(`http://127.0.0.1:${portA}`, { path: '/v1/updates',
            transports: ['websocket'], reconnection: false,
            auth: { token, clientType: 'session-scoped', sessionId,
                supportsMessageReceipt: true } });
        sockets.push(sessionSocket);
        await new Promise<void>((resolve, reject) => {
            sessionSocket.once('connect', resolve); sessionSocket.once('connect_error', reject);
            setTimeout(() => reject(new Error('Session socket timeout')), 5000).unref();
        });
        await eventually(async () => (await api(portB,
            `/presence?accountId=${accountId}&sessionId=${sessionId}`)).online);
        assert.equal((await api(portB,
            `/presence?accountId=${accountId}&sessionId=${sessionId}`)).receipt, true);
        assert.equal((await api(portB,
            `/presence?accountId=${otherAccountId}&sessionId=${sessionId}`)).online, false);
        const messageReceived = new Promise<any>((resolve, reject) => {
            sessionSocket.on('update', payload => {
                if (payload.body?.t === 'new-message' &&
                    payload.body.message?.localId === marker) resolve(payload);
            });
            setTimeout(() => reject(new Error('Remote session message timed out')), 5000).unref();
        });
        const dispatchedMessage = await api(portB, '/message', { accountId, sessionId,
            localId: marker });
        assert.equal((await messageReceived).body.message.localId, marker);
        assert.equal(dispatchedMessage.ownerSessionScopedDeliveries, 1);
        const deliveryIssue = await db.sessionMessageDeliveryIssue.findUniqueOrThrow({
            where: { sessionMessageId: dispatchedMessage.message.id } });
        assert.equal(deliveryIssue.status, 'waiting');
        console.log('REAL_TWO_PROCESS_SESSION_MESSAGE_RECEIPT_WAITING_OK');
        sessionSocket.disconnect();
        await eventually(async () => !(await api(portB,
            `/presence?accountId=${accountId}&sessionId=${sessionId}`)).online);
        const socketCall = (caller: ReturnType<typeof io>, methodName: string) =>
            new Promise<any>((resolve, reject) => {
                caller.timeout(5000).emit('rpc-call', { method: methodName,
                    params: { ownedFixture: marker } }, (error: Error | null, result: any) =>
                    error ? reject(error) : resolve(result));
            });
        assert.deepEqual(await socketCall(userB, method), { ok: true,
            result: { owner: 'A' } });
        let foreignEventDelivered = false;
        userA.on('ephemeral', value => {
            if (value.marker === `${marker}-foreign`) foreignEventDelivered = true;
        });
        const event = new Promise<any>((resolve, reject) => {
            userA.on('ephemeral', value => { if (value.marker === marker) resolve(value); });
            setTimeout(() => reject(new Error('Remote event timeout')), 5000).unref();
        });
        await api(portB, '/emit', { accountId, marker });
        assert.equal((await event).marker, marker);
        await api(portB, '/emit', { accountId: otherAccountId,
            marker: `${marker}-foreign` });
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(foreignEventDelivered, false);
        const agent = await db.aiAgent.create({ data: { accountId, name: marker,
            role: 'fixture', description: '', emoji: '', instructions: '', settings: {} } });
        agentId = agent.id;
        const conversation = await db.aiConversation.create({ data: { accountId,
            scopeKey: marker, kind: 'direct', agentId, title: marker } });
        conversationId = conversation.id;
        const run = await db.orchestratorRun.create({ data: { accountId, title: marker,
            status: 'running', tasks: { create: { seq: 1, taskKey: 'primary',
                provider: 'codex', prompt: 'Owned fixture', status: 'dispatching',
                targetMachineId: machineId, assignedAgentId: agentId,
                permissionMode: 'read_only' } } }, include: { tasks: true } });
        runId = run.id;
        const dispatchToken = randomUUID();
        const execution = await db.orchestratorExecution.create({ data: { runId,
            taskId: run.tasks[0].id, machineId, provider: 'codex', status: 'dispatching',
            dispatchToken } });
        await db.aiWorkItem.create({ data: { accountId, title: marker,
            summary: 'Owned cross-instance dispatch', sourceType: 'execution',
            sourceLabel: 'fixture', sourceResourceId: runId, assigneeId: agentId,
            conversationId, orchestratorRunId: runId,
            orchestratorTaskId: run.tasks[0].id } });
        await eventually(async () => (await api(portB,
            `/methods?accountId=${accountId}`)).methods.includes(featureMethod));
        const dispatched = await api(portB, '/dispatch', { type: 'dispatch', accountId,
            machineId, runId, taskId: run.tasks[0].id, executionId: execution.id,
            dispatchToken, payload: { executionId: execution.id, runId,
                taskId: run.tasks[0].id, dispatchToken, provider: 'codex',
                executionType: 'initial', prompt: 'Owned fixture', timeoutMs: 60_000,
                permissionMode: 'read_only', assignedAgentId: agentId } });
        assert.equal(dispatched.capabilityProtocolVersion, 1);
        assert.match(dispatchedCapability?.token ?? '', /^[0-9a-f]{64}$/);
        const persisted = await db.aiExecutionCapability.findFirstOrThrow({ where: {
            executionId: execution.id } });
        assert.equal(persisted.tokenHash, createHash('sha256')
            .update(dispatchedCapability.token).digest('hex'));
        console.log('REAL_TWO_PROCESS_AI_SCHEDULER_CAPABILITY_DISPATCH_OK');
        machineA.removeAllListeners('rpc-request');
        let reached!: () => void;
        let replyOld!: () => void;
        const oldReached = new Promise<void>(resolve => { reached = resolve; });
        machineA.on('rpc-request', (_message, ack) => {
            replyOld = () => ack({ owner: 'A-late' });
            reached();
        });
        const late = api(portB, '/invoke', { accountId, method });
        await oldReached;
        const machineB = await connect(portB, 'machine-scoped');
        machineB.on('rpc-request', (_message, ack) => ack({ owner: 'B' }));
        await register(machineB, method);
        replyOld();
        await assert.rejects(late, /RPC owner changed/);
        assert.deepEqual(await socketCall(userA, method), { ok: true,
            result: { owner: 'B' } });
        assert.deepEqual((await api(portA, '/invoke', { accountId, method })).response, { owner: 'B' });
        children[0].kill('SIGKILL');
        const crashKey = `happy:rpc:route:v1:${createHash('sha256').update(accountId)
            .update('\0').update(crashMethod).digest('hex')}`;
        await redis.pexpire(crashKey, 500);
        await new Promise(resolve => setTimeout(resolve, 750));
        await assert.rejects(api(portB, '/invoke', { accountId, method: crashMethod }));
        console.log('REAL_TWO_PROCESS_RPC_OWNER_FENCE_AND_EVENT_ROUTING_OK');
    } finally {
        for (const socket of sockets) socket.disconnect();
        for (const child of children) child.kill('SIGTERM');
        await Promise.all(children.map(child => new Promise(resolve => {
            if (child.exitCode !== null) resolve(undefined);
            else child.once('exit', resolve);
            setTimeout(() => { child.kill('SIGKILL'); resolve(undefined); }, 3000).unref();
        })));
        if (accountId && fixtureMachineId) {
            for (const suffix of ['orchestrator-dispatch', 'orchestrator-features',
                'ai-structured-model', 'orchestrator-cancel']) {
                const routeId = createHash('sha256').update(accountId).update('\0')
                    .update(`${fixtureMachineId}:${suffix}`).digest('hex');
                await redis.del(`happy:rpc:route:v1:${routeId}`,
                    `happy:rpc:epoch:v1:${routeId}`);
            }
        }
        if (accountId) {
            if (runId) await db.orchestratorRun.deleteMany({ where: { id: runId,
                accountId } });
            if (conversationId) await db.aiConversation.deleteMany({ where: {
                id: conversationId, accountId } });
            if (sessionId) {
                await db.sessionMessage.deleteMany({ where: { sessionId } });
                await db.session.deleteMany({ where: { id: sessionId, accountId } });
            }
            if (agentId) await db.aiAgent.deleteMany({ where: { id: agentId,
                accountId } });
            await db.aiWorkspace.deleteMany({ where: { ownerAccountId: accountId } });
            await db.machine.deleteMany({ where: { accountId } });
            await db.account.deleteMany({ where: { id: accountId,
                publicKey: `rpc-cross-${marker}` } });
        }
        if (otherAccountId) await db.account.deleteMany({ where: { id: otherAccountId,
            publicKey: `rpc-cross-other-${marker}` } });
        await db.$disconnect();
        redis.disconnect();
    }
    process.exit(0);
}
