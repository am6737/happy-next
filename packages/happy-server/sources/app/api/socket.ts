import { onShutdown } from "@/utils/shutdown";
import { Fastify } from "./types";
import { buildMachineActivityEphemeral, ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { Server, Socket } from "socket.io";
import { log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import { decrementWebSocketConnection, incrementWebSocketConnection, websocketEventsCounter } from "../monitoring/metrics2";
import { usageHandler } from "./socket/usageHandler";
import { rpcHandler } from "./socket/rpcHandler";
import { pingHandler } from "./socket/pingHandler";
import { sessionUpdateHandler } from "./socket/sessionUpdateHandler";
import { machineUpdateHandler } from "./socket/machineUpdateHandler";
import { artifactUpdateHandler } from "./socket/artifactUpdateHandler";
import { accessKeyHandler } from "./socket/accessKeyHandler";
import { terminalStreamHandler } from "./socket/terminalStreamHandler";
import { cleanupUserRpcSocket, enableDistributedRpc, getOrCreateUserRpcListeners,
    stopDistributedRpc } from "./socket/rpcRegistry";
import { db } from "@/storage/db";
import { registerSessionPresence, unregisterSessionPresence } from "@/app/events/eventBridge";

export function startSocket(app: Fastify) {
    enableDistributedRpc();
    void eventRouter.startDistributed().catch(error =>
        log({ module: 'event-bridge', level: 'error' }, String(error)));
    const io = new Server(app.server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "OPTIONS"],
            credentials: true,
            allowedHeaders: ["*"]
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 45000,
        pingInterval: 15000,
        maxHttpBufferSize: 5e6,
        path: '/v1/updates',
        allowUpgrades: true,
        upgradeTimeout: 10000,
        connectTimeout: 20000,
        serveClient: false // Don't serve the client files
    });

    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token as string;
        const clientType = socket.handshake.auth.clientType as 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
        const sessionId = socket.handshake.auth.sessionId as string | undefined;
        const machineId = socket.handshake.auth.machineId as string | undefined;
        if (!token) {
            return next(new Error('Missing authentication token'));
        }
        if (clientType === 'session-scoped' && !sessionId) {
            return next(new Error('Session ID required'));
        }
        if (clientType === 'machine-scoped' && !machineId) {
            return next(new Error('Machine ID required'));
        }
        let verified: Awaited<ReturnType<typeof auth.verifyToken>>;
        try { verified = await auth.verifyToken(token); }
        catch { return next(new Error('Invalid authentication token')); }
        if (!verified) return next(new Error('Invalid authentication token'));
        const userId = verified.userId;
        try {
        if (clientType === 'session-scoped') {
            const session = await db.session.findFirst({ where: { id: sessionId,
                accountId: userId }, select: { id: true } });
            if (!session) return next(new Error('Session is unavailable'));
        }
        if (clientType === 'machine-scoped') {
            const machine = await db.machine.findFirst({ where: { id: machineId, accountId: userId },
                select: { id: true } });
            if (!machine) return next(new Error('Machine is unavailable'));
        }
        } catch {
            return next(new Error('Connection authorization unavailable'));
        }
        socket.data.authenticatedUserId = userId;
        next();
    });

    io.on("connection", (socket) => {
        const clientType = socket.handshake.auth.clientType as 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
        const sessionId = socket.handshake.auth.sessionId as string | undefined;
        const machineId = socket.handshake.auth.machineId as string | undefined;
        const supportsMessageReceipt = socket.handshake.auth.supportsMessageReceipt === true;
        const userId = socket.data.authenticatedUserId as string;
        log({ module: 'websocket' }, `Token verified: ${userId}, clientType: ${clientType || 'user-scoped'}, sessionId: ${sessionId || 'none'}, machineId: ${machineId || 'none'}, socketId: ${socket.id}`);

        // Store connection based on type
        const metadata = { clientType: clientType || 'user-scoped', sessionId, machineId };
        let connection: ClientConnection;
        if (metadata.clientType === 'session-scoped' && sessionId) {
            connection = {
                connectionType: 'session-scoped',
                socket,
                userId,
                sessionId,
                supportsMessageReceipt
            };
        } else if (metadata.clientType === 'machine-scoped' && machineId) {
            connection = {
                connectionType: 'machine-scoped',
                socket,
                userId,
                machineId
            };
        } else {
            connection = {
                connectionType: 'user-scoped',
                socket,
                userId
            };
        }
        eventRouter.addConnection(userId, connection);
        if (connection.connectionType === 'session-scoped') {
            void registerSessionPresence(userId, connection.sessionId, socket.id,
                connection.supportsMessageReceipt).catch(error =>
                log({ module: 'event-bridge', level: 'error' }, String(error)));
        }
        incrementWebSocketConnection(connection.connectionType);

        // Broadcast daemon online status
        if (connection.connectionType === 'machine-scoped') {
            // Broadcast daemon online
            const machineActivity = buildMachineActivityEphemeral(machineId!, true, Date.now());
            eventRouter.emitEphemeral({
                userId,
                payload: machineActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        }

        socket.on('disconnect', () => {
            websocketEventsCounter.inc({ event_type: 'disconnect' });

            // Cleanup connections
            eventRouter.removeConnection(userId, connection);
            if (connection.connectionType === 'session-scoped') {
                void unregisterSessionPresence(socket.id).catch(error =>
                    log({ module: 'event-bridge', level: 'error' }, String(error)));
            }
            decrementWebSocketConnection(connection.connectionType);

            log({ module: 'websocket' }, `User disconnected: ${userId}`);

            // Broadcast daemon offline status
            if (connection.connectionType === 'machine-scoped') {
                const machineActivity = buildMachineActivityEphemeral(connection.machineId, false, Date.now());
                eventRouter.emitEphemeral({
                    userId,
                    payload: machineActivity,
                    recipientFilter: { type: 'user-scoped-only' }
                });
            }

            void cleanupUserRpcSocket(userId, socket).catch(error =>
                log({ module: 'websocket-rpc', level: 'error' }, String(error)));
        });

        // Handlers
        const userRpcListeners = getOrCreateUserRpcListeners(userId);
        rpcHandler(userId, socket, userRpcListeners, connection);
        usageHandler(userId, socket);
        sessionUpdateHandler(userId, socket, connection);
        pingHandler(socket);
        machineUpdateHandler(userId, socket);
        artifactUpdateHandler(userId, socket);
        accessKeyHandler(userId, socket);
        terminalStreamHandler(userId, socket, connection);

        // Ready
        log({ module: 'websocket' }, `User connected: ${userId}`);
    });

    onShutdown('api', async () => {
        await io.close();
        await stopDistributedRpc();
        eventRouter.stopDistributed();
    });
}
