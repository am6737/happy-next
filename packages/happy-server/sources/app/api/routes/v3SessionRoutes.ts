import {
    buildPendingMessageDeleteEphemeral,
    buildPendingMessageUpsertEphemeral,
    eventRouter,
} from "@/app/events/eventRouter";
import { canSendMessages, canViewSession } from "@/app/share/accessControl";
import { isSessionBusy, markDispatched } from "@/app/presence/sessionTurnRuntime";
import {
    deletePendingMessage,
    enqueuePendingMessage,
    listPendingMessages,
    pausePendingMessage,
    pinPendingMessage,
    updatePendingMessageContent,
    type PendingMessageRecord,
} from "@/app/session/pendingMessageService";
import { dispatchNextPendingIfPossible } from "@/app/session/pendingMessageAutoDispatch";
import { dispatchSessionMessage } from "@/app/session/sessionMessageDispatch";
import { db } from "@/storage/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { type Fastify } from "../types";
import { scheduleFirstMessageReplay } from "./firstMessageReplay";
import { AttachmentLeaseError } from '@/app/chat/chatAttachmentLease';

// A message may contain the advertised 10 files plus up to 4 image inputs.
const attachmentIdsSchema = z.array(z.string().min(1)).max(14).optional().default([]);

const getMessagesQuerySchema = z.object({
    after_seq: z.coerce.number().int().min(0).optional(),
    before_seq: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
});

const sendMessagesBodySchema = z.object({
    messages: z.array(z.object({
        content: z.string(),
        localId: z.string().min(1),
        trackCliDelivery: z.boolean().optional().default(false),
        attachmentIds: attachmentIdsSchema,
    })).min(1).max(200),
});

const sendMessageBodySchema = z.object({
    content: z.string(),
    localId: z.string().min(1),
    trackCliDelivery: z.boolean().optional().default(false),
    attachmentIds: attachmentIdsSchema,
});

const pendingMessageParamsSchema = z.object({
    sessionId: z.string(),
    pendingId: z.string(),
});

type SelectedMessage = {
    id: string;
    seq: number;
    content: unknown;
    localId: string | null;
    sentBy: string | null;
    sentByName: string | null;
    deliveryIssue?: {
        status: "waiting" | "error";
        reason: string | null;
    } | null;
    createdAt: Date;
    updatedAt: Date;
};

type SendResponseMessage = Omit<SelectedMessage, "content" | "deliveryIssue">;

type ExistingSendMessage = {
    id: string;
    seq: number;
    localId: string | null;
    sentBy: string | null;
    sentByName: string | null;
    createdAt: Date;
    updatedAt: Date;
};

function toResponseMessage(message: SelectedMessage) {
    return {
        id: message.id,
        seq: message.seq,
        content: message.content,
        localId: message.localId,
        sentBy: message.sentBy,
        sentByName: message.sentByName,
        deliveryIssue: message.deliveryIssue
            ? {
                status: message.deliveryIssue.status,
                reason: message.deliveryIssue.reason,
            }
            : undefined,
        createdAt: message.createdAt.getTime(),
        updatedAt: message.updatedAt.getTime(),
    };
}

function toSendResponseMessage(message: SendResponseMessage) {
    return {
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        sentBy: message.sentBy,
        sentByName: message.sentByName,
        createdAt: message.createdAt.getTime(),
        updatedAt: message.updatedAt.getTime(),
    };
}

function toPendingResponseMessage(message: PendingMessageRecord) {
    return {
        id: message.id,
        localId: message.localId,
        content: message.content,
        sentBy: message.sentBy,
        sentByName: message.sentByName,
        trackCliDelivery: message.trackCliDelivery,
        pinnedAt: message.pinnedAt ? message.pinnedAt.getTime() : null,
        pausedAt: message.pausedAt ? message.pausedAt.getTime() : null,
        createdAt: message.createdAt.getTime(),
        updatedAt: message.updatedAt.getTime(),
    };
}

function extractEncryptedText(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (
        content &&
        typeof content === "object" &&
        "t" in content &&
        "c" in content &&
        (content as { t?: unknown }).t === "encrypted" &&
        typeof (content as { c?: unknown }).c === "string"
    ) {
        return (content as { c: string }).c;
    }

    return "";
}

async function getSessionOwnerId(sessionId: string): Promise<string | null> {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { accountId: true },
    });

    return session?.accountId ?? null;
}

async function getSenderName(userId: string): Promise<string | null> {
    const senderAccount = await db.account.findUnique({
        where: { id: userId },
        select: { firstName: true, username: true },
    });

    return senderAccount?.firstName || senderAccount?.username || null;
}

async function findExistingSentMessageByLocalId(sessionId: string, localId: string): Promise<ExistingSendMessage | null> {
    const existingMessages = await db.sessionMessage.findMany({
        where: {
            sessionId,
            localId: { in: [localId] },
        },
        take: 1,
        select: {
            id: true,
            seq: true,
            localId: true,
            sentBy: true,
            sentByName: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return (existingMessages[0] as ExistingSendMessage | undefined) ?? null;
}

async function emitPendingUpsert(ownerId: string, sessionId: string, pending: PendingMessageRecord) {
    await eventRouter.emitEphemeralToSessionSubscribers({
        ownerId,
        sessionId,
        payload: buildPendingMessageUpsertEphemeral(sessionId, pending),
        recipientFilter: { type: "all-interested-in-session", sessionId },
    });
}

async function emitPendingDelete(ownerId: string, sessionId: string, pendingId: string) {
    await eventRouter.emitEphemeralToSessionSubscribers({
        ownerId,
        sessionId,
        payload: buildPendingMessageDeleteEphemeral(sessionId, pendingId),
        recipientFilter: { type: "all-interested-in-session", sessionId },
    });
}

export function resolveSendMode(input: { hasPending: boolean; isThinking: boolean }): "queued" | "sent" {
    if (input.hasPending || input.isThinking) {
        return "queued";
    }

    return "sent";
}

export function v3SessionRoutes(app: Fastify) {
    app.get("/v3/sessions/:sessionId/messages", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            }),
            querystring: getMessagesQuerySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const { after_seq, before_seq, limit } = request.query;

        if (after_seq !== undefined && before_seq !== undefined) {
            return reply.code(400).send({ error: "Cannot specify both after_seq and before_seq" });
        }

        const session = await db.session.findFirst({
            where: {
                id: sessionId,
                OR: [
                    { accountId: userId },
                    { shares: { some: { sharedWithUserId: userId } } },
                ],
            },
            select: { id: true },
        });

        if (!session) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const isForward = after_seq !== undefined;
        const seqFilter = after_seq !== undefined
            ? { gt: after_seq }
            : before_seq !== undefined
                ? { lt: before_seq }
                : undefined;
        const orderBy = isForward ? "asc" as const : "desc" as const;

        const messages = await db.sessionMessage.findMany({
            where: {
                sessionId,
                ...(seqFilter ? { seq: seqFilter } : {}),
            },
            orderBy: { seq: orderBy },
            take: limit + 1,
            select: {
                id: true,
                seq: true,
                content: true,
                localId: true,
                sentBy: true,
                sentByName: true,
                deliveryIssue: {
                    select: {
                        status: true,
                        reason: true,
                    },
                },
                createdAt: true,
                updatedAt: true,
            },
        });
        const oldestMessage = await db.sessionMessage.findFirst({
            where: { sessionId },
            orderBy: { seq: "asc" },
            select: { seq: true },
        });

        const hasMore = messages.length > limit;
        const page = hasMore ? messages.slice(0, limit) : messages;

        return reply.send({
            messages: page.map(toResponseMessage),
            hasMore,
            oldestSeq: oldestMessage?.seq ?? null,
        });
    });

    app.post("/v3/sessions/:sessionId/messages", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            }),
            body: sendMessagesBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const { messages } = request.body;

        if (!await canSendMessages(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const ownerId = await getSessionOwnerId(sessionId);
        if (!ownerId) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const sentByName = await getSenderName(userId);

        const firstMessageByLocalId = new Map<string, { localId: string; content: string; trackCliDelivery: boolean; attachmentIds: string[] }>();
        for (const message of messages) {
            if (!firstMessageByLocalId.has(message.localId)) {
                firstMessageByLocalId.set(message.localId, message);
            }
        }

        const uniqueMessages = Array.from(firstMessageByLocalId.values());
        const existingMessages = await db.sessionMessage.findMany({
            where: {
                sessionId,
                localId: { in: uniqueMessages.map((message) => message.localId) },
            },
            select: {
                id: true,
                seq: true,
                localId: true,
                sentBy: true,
                sentByName: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        const existingByLocalId = new Map<string, ExistingSendMessage>();
        for (const message of existingMessages) {
            if (message.localId) {
                existingByLocalId.set(message.localId, message as ExistingSendMessage);
            }
        }

        const responseMessages: ExistingSendMessage[] = [];
        for (const message of uniqueMessages) {
            const existing = existingByLocalId.get(message.localId);
            if (existing) {
                responseMessages.push(existing);
                continue;
            }

            let dispatched: Awaited<ReturnType<typeof dispatchSessionMessage>>;
            try {
                dispatched = await dispatchSessionMessage({
                    ownerId,
                    sessionId,
                    content: message.content,
                    localId: message.localId,
                    sentBy: userId,
                    sentByName,
                    trackCliDelivery: message.trackCliDelivery,
                    attachmentIds: message.attachmentIds,
                });
            } catch (error) {
                if (error instanceof AttachmentLeaseError) {
                    return reply.code(400).send({ error: error.message });
                }
                throw error;
            }

            if (dispatched.message.seq === 1 && dispatched.ownerSessionScopedDeliveries === 0) {
                scheduleFirstMessageReplay({
                    ownerId,
                    sessionId,
                    message: {
                        ...dispatched.message,
                        content: {
                            t: "encrypted",
                            c: message.content,
                        },
                    },
                });
            }

            responseMessages.push(dispatched.message);
        }

        responseMessages.sort((a, b) => a.seq - b.seq);

        return reply.send({
            messages: responseMessages.map(toSendResponseMessage),
        });
    });

    app.get("/v3/sessions/:sessionId/pending-messages", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        // Read access is enough to view the pending queue — mirror GET /messages,
        // which only requires view-level access. Gating this behind edit access
        // (canSendMessages) 404s view-only shared sessions, and the client then
        // retries the "permanent" 404 forever. Mutations below still require edit.
        if (!await canViewSession(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const messages = await listPendingMessages(sessionId);
        return reply.send({
            messages: messages.map(toPendingResponseMessage),
        });
    });

    app.post("/v3/sessions/:sessionId/send", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            }),
            body: sendMessageBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const { localId, content, trackCliDelivery, attachmentIds } = request.body;

        if (!await canSendMessages(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const ownerId = await getSessionOwnerId(sessionId);
        if (!ownerId) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const existingSentMessage = await findExistingSentMessageByLocalId(sessionId, localId);
        if (existingSentMessage) {
            return reply.send({
                mode: "sent",
                message: toSendResponseMessage(existingSentMessage),
            });
        }

        const sentByName = await getSenderName(userId);

        // Only *active* (non-paused) pending messages gate new sends. Paused
        // drafts are invisible to the queue decision: a lone draft must not
        // force every new message into the queue while the session is idle.
        const hasPending = !!await db.sessionPendingMessage.findFirst({
            where: {
                sessionId,
                pausedAt: null,
            },
            select: {
                id: true,
            },
        });

        const mode = resolveSendMode({
            hasPending,
            isThinking: isSessionBusy(sessionId),
        });

        if (mode === "queued") {
            let pendingResult: Awaited<ReturnType<typeof enqueuePendingMessage>>;
            try {
                pendingResult = await enqueuePendingMessage({
                    sessionId,
                    localId,
                    content,
                    sentBy: userId,
                    sentByName,
                    trackCliDelivery,
                    attachmentIds,
                });
            } catch (error) {
                if (error instanceof AttachmentLeaseError) {
                    return reply.code(400).send({ error: error.message });
                }
                throw error;
            }
            const { message: pendingMessage, created } = pendingResult;

            if (created) {
                await emitPendingUpsert(ownerId, sessionId, pendingMessage);
            }

            await dispatchNextPendingIfPossible({
                ownerId,
                sessionId,
            });

            return reply.send({
                mode,
                pending: toPendingResponseMessage(pendingMessage),
            });
        }

        let dispatched: Awaited<ReturnType<typeof dispatchSessionMessage>>;
        try {
            dispatched = await dispatchSessionMessage({
                ownerId,
                sessionId,
                content,
                localId,
                sentBy: userId,
                sentByName,
                trackCliDelivery,
                attachmentIds,
            });
        } catch (error) {
            if (error instanceof AttachmentLeaseError) {
                return reply.code(400).send({ error: error.message });
            }
            // A concurrent request sharing this localId (e.g. hedged retries) may
            // have inserted the message between our existence check above and the
            // create. Treat the unique-constraint violation as idempotent and
            // return the row the other request created, mirroring the dedup branch.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const winner = await findExistingSentMessageByLocalId(sessionId, localId);
                if (winner) {
                    return reply.send({
                        mode: "sent",
                        message: toSendResponseMessage(winner),
                    });
                }
            }
            throw error;
        }

        if (dispatched.message.seq === 1 && dispatched.ownerSessionScopedDeliveries === 0) {
            scheduleFirstMessageReplay({
                ownerId,
                sessionId,
                message: {
                    ...dispatched.message,
                    content: {
                        t: "encrypted",
                        c: content,
                    },
                },
            });
        }

        // Direct send doesn't pass through the auto-dispatch worker, but we still
        // mark the runtime as awaiting turn start so subsequent /send calls queue
        // until we observe the next thinking=true heartbeat.
        markDispatched(sessionId);

        return reply.send({
            mode,
            message: toSendResponseMessage(dispatched.message),
        });
    });

    app.post("/v3/sessions/:sessionId/pending-messages/:pendingId/pin", {
        preHandler: app.authenticate,
        schema: {
            params: pendingMessageParamsSchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, pendingId } = request.params;

        if (!await canSendMessages(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const ownerId = await getSessionOwnerId(sessionId);
        if (!ownerId) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const pending = await pinPendingMessage(sessionId, pendingId);
        if (!pending) {
            return reply.code(404).send({ error: "Pending message not found" });
        }

        await emitPendingUpsert(ownerId, sessionId, pending);

        return reply.send({
            message: toPendingResponseMessage(pending),
        });
    });

    app.post("/v3/sessions/:sessionId/pending-messages/:pendingId/pause", {
        preHandler: app.authenticate,
        schema: {
            params: pendingMessageParamsSchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, pendingId } = request.params;

        if (!await canSendMessages(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const ownerId = await getSessionOwnerId(sessionId);
        if (!ownerId) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const pending = await pausePendingMessage(sessionId, pendingId);
        if (!pending) {
            return reply.code(404).send({ error: "Pending message not found" });
        }

        await emitPendingUpsert(ownerId, sessionId, pending);

        return reply.send({
            message: toPendingResponseMessage(pending),
        });
    });

    app.patch("/v3/sessions/:sessionId/pending-messages/:pendingId", {
        preHandler: app.authenticate,
        schema: {
            params: pendingMessageParamsSchema,
            body: z.object({
                content: z.string(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, pendingId } = request.params;
        const { content } = request.body;

        if (!await canSendMessages(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const ownerId = await getSessionOwnerId(sessionId);
        if (!ownerId) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const pending = await updatePendingMessageContent(sessionId, pendingId, content);
        if (!pending) {
            return reply.code(404).send({ error: "Pending message not found" });
        }

        await emitPendingUpsert(ownerId, sessionId, pending);

        return reply.send({
            message: toPendingResponseMessage(pending),
        });
    });

    app.delete("/v3/sessions/:sessionId/pending-messages/:pendingId", {
        preHandler: app.authenticate,
        schema: {
            params: pendingMessageParamsSchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, pendingId } = request.params;

        if (!await canSendMessages(userId, sessionId)) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const ownerId = await getSessionOwnerId(sessionId);
        if (!ownerId) {
            return reply.code(404).send({ error: "Session not found" });
        }

        const pending = await deletePendingMessage(sessionId, pendingId);
        if (!pending) {
            return reply.code(404).send({ error: "Pending message not found" });
        }

        await emitPendingDelete(ownerId, sessionId, pending.id);

        return reply.send({
            ok: true,
            pendingId: pending.id,
        });
    });

}
