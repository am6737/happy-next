import { z } from "zod";
import { Fastify } from "../types";
import { forwardRpcCall } from "../socket/rpcHandler";
import { getOrCreateUserRpcListeners } from "../socket/rpcRegistry";

export function rpcRoutes(app: Fastify) {
    // POST /v1/rpc - The socket's rpc-call over HTTP, for clients that hold no socket: the watch,
    // which watchOS gives no WebSocket, and the iPhone answering a notification action in the
    // background. Params stay encrypted end to end; the server only relays them.
    app.post('/v1/rpc', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                method: z.string().min(1),
                params: z.any()
            })
        }
    }, async (request, reply) => {
        const response = await forwardRpcCall(
            request.userId,
            request.body,
            getOrCreateUserRpcListeners(request.userId),
            null,
        );
        return reply.send(response);
    });
}
