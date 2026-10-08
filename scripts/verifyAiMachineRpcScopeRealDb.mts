import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { db } from '../packages/happy-server/sources/storage/db';
import { redis } from '../packages/happy-server/sources/storage/redis';
import { auth } from '../packages/happy-server/sources/app/auth/auth';
import { startSocket } from '../packages/happy-server/sources/app/api/socket';
import { invokeUserRpc } from '../packages/happy-server/sources/app/api/socket/rpcRegistry';
import { executeSchedulerActions } from '../packages/happy-server/sources/app/orchestrator/scheduler';
import { awaitShutdown } from '../packages/happy-server/sources/utils/shutdown';

// Actual JWT, PostgreSQL, Socket.IO and invokeUserRpc. Raw clients and RPC
// responses are owned fixtures, not a managed daemon/provider acceptance.
const require = createRequire(new URL('../packages/happy-server/package.json', import.meta.url));
const { io } = require('socket.io-client');
const app = require('fastify')({ logger: false });
const tag = `rpc-scope-${randomUUID()}`;
const accounts: string[] = []; const sockets: any[] = [];
const runs: string[] = [];
const originalMachineRead = db.machine.findFirst.bind(db.machine);
let releaseRead: (() => void) | undefined;
let ownedRouteHash: string | undefined;
function event(socket: any, success: string, failure: string, emit?: () => void): Promise<any> {
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); socket.off(success, ok); socket.off(failure, bad); };
        const ok = (value: any) => { cleanup(); resolve(value); };
        const bad = (value: any) => { cleanup(); reject(new Error(value?.error ?? value?.message ?? failure)); };
        const timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout: ${success}`)); }, 8000);
        socket.once(success, ok); socket.once(failure, bad); emit?.();
    });
}
try {
    await auth.init();
    for (let i = 0; i < 2; i++) accounts.push((await db.account.create({ data: { publicKey: `${tag}-${i}` } })).id);
    const machineId = randomUUID();
    await db.machine.create({ data: { id: machineId, accountId: accounts[0], metadata: '{}' } });
    const session = await db.session.create({ data: { accountId: accounts[0], tag, metadata: '{}' } });
    startSocket(app);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const tokens = await Promise.all(accounts.map(id => auth.createToken(id)));
    const connect = async (extra: object, token = tokens[0], rejected = false) => {
        const socket = io(base, { path: '/v1/updates', transports: ['websocket'],
            auth: { token, ...extra }, autoConnect: false, reconnection: false });
        sockets.push(socket);
        if (rejected) await event(socket, 'connect_error', 'connect', () => socket.connect());
        else await event(socket, 'connect', 'connect_error', () => socket.connect());
        return socket;
    };
    const method = `${machineId}:orchestrator-dispatch`;
    ownedRouteHash = createHash('sha256').update(accounts[0]).update('\0').update(method).digest('hex');
    const register = (socket: any, rejected = false) => event(socket,
        rejected ? 'rpc-error' : 'rpc-registered', rejected ? 'rpc-registered' : 'rpc-error',
        () => socket.emit('rpc-register', { method }));
    const machine = await connect({ clientType: 'machine-scoped', machineId });
    let oldAck: ((value: object) => void) | undefined; let signalOldRequest!: () => void;
    const oldRequest = new Promise<void>(resolve => { signalOldRequest = resolve; });
    machine.on('rpc-request', (request: any, ack: any) => {
        if (request.params?.waitForOwnerChange) { oldAck = ack; signalOldRequest(); }
        else ack({ owner: 'original' });
    });
    await register(machine);
    const check = async (owner: string) => assert.deepEqual(
        await invokeUserRpc(accounts[0], method, { ownedFixture: tag }, 3000), { owner });
    await check('original');
    for (const scope of [{ clientType: 'user-scoped' }, { clientType: 'session-scoped', sessionId: session.id }]) {
        const impostor = await connect(scope);
        impostor.on('rpc-request', (_: any, ack: any) => ack({ owner: 'impostor' }));
        await register(impostor, true); await check('original');
        impostor.disconnect(); await check('original');
    }
    await connect({ clientType: 'machine-scoped', machineId }, tokens[1], true);
    await connect({ clientType: 'machine-scoped', machineId: randomUUID() }, tokens[0], true);
    await connect({ clientType: 'session-scoped', sessionId: session.id }, tokens[1], true);
    const pendingOldAck = process.argv.includes('--ack-owner-change')
        ? invokeUserRpc(accounts[0], method, { waitForOwnerChange: true }, 3000)
            .then(value => ({ value, error: null }), error => ({ value: null, error })) : null;
    if (pendingOldAck) await oldRequest;
    const replacement = await connect({ clientType: 'machine-scoped', machineId });
    let dispatches = 0;
    replacement.on('rpc-request', (request: any, ack: any) => {
        if (request.params?.executionId) dispatches++;
        ack({ owner: 'replacement' });
    });
    await register(replacement); await check('replacement');
    if (process.argv.includes('--legacy-ai-dispatch')) {
        const agent = await db.aiAgent.create({ data: { accountId: accounts[0], name: tag,
            role: 'fixture', description: '', emoji: '', instructions: '', settings: {} } });
        const conversation = await db.aiConversation.create({ data: { accountId: accounts[0],
            scopeKey: tag, kind: 'direct', agentId: agent.id, title: tag } });
        const run = await db.orchestratorRun.create({ data: { accountId: accounts[0], title: tag,
            status: 'running', tasks: { create: { seq: 1, taskKey: 'legacy-ai', provider: 'codex',
                prompt: '', status: 'dispatching', targetMachineId: machineId, assignedAgentId: agent.id,
                permissionMode: 'read_only' } } }, include: { tasks: true } }); runs.push(run.id);
        const execution = await db.orchestratorExecution.create({ data: { runId: run.id,
            taskId: run.tasks[0].id, machineId, provider: 'codex', status: 'dispatching', dispatchToken: randomUUID() } });
        await db.aiWorkItem.create({ data: { accountId: accounts[0], title: tag, summary: 'Owned new AI dispatch',
            sourceType: 'execution', sourceLabel: 'fixture', sourceResourceId: run.id, assigneeId: agent.id,
            conversationId: conversation.id, orchestratorRunId: run.id, orchestratorTaskId: run.tasks[0].id } });
        await executeSchedulerActions([{ type: 'dispatch', accountId: accounts[0], machineId,
            runId: run.id, taskId: run.tasks[0].id, executionId: execution.id, dispatchToken: execution.dispatchToken,
            payload: { executionId: execution.id, runId: run.id, taskId: run.tasks[0].id,
                dispatchToken: execution.dispatchToken, provider: 'codex', executionType: 'initial',
                prompt: 'Owned fixture', timeoutMs: 60000, permissionMode: 'read_only', assignedAgentId: agent.id } }]);
        const after = await db.orchestratorExecution.findUniqueOrThrow({ where: { id: execution.id } });
        console.log(JSON.stringify({ result: 'REAL_SOCKET_NEW_AI_DISPATCH_NO_FEATURE_NEGOTIATION',
            dispatches, protocolVersion: after.capabilityProtocolVersion, status: after.status }));
        assert.equal(dispatches, 0, 'New AI execution downgraded to legacy dispatch without a capability protocol');
    }
    if (pendingOldAck) {
        oldAck!({ owner: 'stale-original' });
        const outcome = await pendingOldAck;
        assert.ok(outcome.error, 'Old owner ACK was accepted after replacement registration');
        assert.match(outcome.error.message, /owner changed/i);
        console.log('REAL_REDIS_SOCKET_OLD_OWNER_ACK_FENCED_OK');
    }
    await event(machine, 'rpc-unregistered', 'rpc-error', () => machine.emit('rpc-unregister', { method }));
    await check('replacement');
    machine.disconnect();
    // A server round trip ensures the disconnect cleanup has an opportunity to run.
    await register(replacement); await check('replacement');
    if (process.argv.includes('--register-disconnect-race')) {
        const delayed = await connect({ clientType: 'machine-scoped', machineId });
        let intercepted = false; let signalRead!: () => void;
        const reached = new Promise<void>(resolve => { signalRead = resolve; });
        const release = new Promise<void>(resolve => { releaseRead = resolve; });
        db.machine.findFirst = (async (args: any) => {
            const result = await originalMachineRead(args);
            if (!intercepted && args.where?.id === machineId) {
                intercepted = true; signalRead(); await release;
            }
            return result;
        }) as typeof db.machine.findFirst;
        delayed.emit('rpc-register', { method });
        await Promise.race([reached, new Promise((_, reject) => setTimeout(() => reject(new Error('Read barrier not reached')), 4000).unref())]);
        delayed.disconnect();
        await register(replacement);
        releaseRead();
        // Drain the intercepted handler continuation before checking the route.
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 50));
        await check('replacement');
        console.log('REAL_SOCKET_DISCONNECTED_REGISTER_CANNOT_REPLACE_LIVE_OWNER_OK');
    }
    console.log('REAL_DB_JWT_SOCKET_MACHINE_RPC_SCOPE_TENANT_RECONNECT_OLD_CLEANUP_OK');
} finally {
    releaseRead?.(); db.machine.findFirst = originalMachineRead;
    for (const socket of sockets) socket.disconnect();
    const shutdown = awaitShutdown(); process.emit('SIGTERM'); await shutdown;
    await db.orchestratorRun.deleteMany({ where: { id: { in: runs }, accountId: accounts[0] } });
    await db.session.deleteMany({ where: { accountId: { in: accounts }, tag } });
    await db.machine.deleteMany({ where: { accountId: { in: accounts } } });
    await db.account.deleteMany({ where: { id: { in: accounts }, publicKey: { startsWith: tag } } });
    assert.equal(await db.account.count({ where: { publicKey: { startsWith: tag } } }), 0);
    if (ownedRouteHash) await redis.del(`happy:rpc:route:v1:${ownedRouteHash}`, `happy:rpc:epoch:v1:${ownedRouteHash}`);
    await db.$disconnect(); redis.disconnect();
    console.log('AI_RPC_SCOPE_FIXTURE_CLEANUP residual=0');
}
// Imported production handlers retain background timers; all owned sockets,
// DB rows and clients have been closed above. Reach this only on success.
process.exit(0);
