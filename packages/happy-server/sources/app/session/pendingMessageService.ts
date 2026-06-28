import { Prisma } from "@prisma/client";
import { db } from "@/storage/db";

export type PendingMessageContent = {
    t: "encrypted";
    c: string;
};

export type PendingMessageRecord = {
    id: string;
    sessionId: string;
    localId: string;
    content: PendingMessageContent;
    sentBy: string | null;
    sentByName: string | null;
    trackCliDelivery: boolean;
    pinnedAt: Date | null;
    pausedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

const pendingMessageSelect = {
    id: true,
    sessionId: true,
    localId: true,
    content: true,
    sentBy: true,
    sentByName: true,
    trackCliDelivery: true,
    pinnedAt: true,
    pausedAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

export async function listPendingMessages(sessionId: string): Promise<PendingMessageRecord[]> {
    const [pinned, normal] = await Promise.all([
        db.sessionPendingMessage.findMany({
            where: {
                sessionId,
                pinnedAt: { not: null },
            },
            orderBy: [
                { pinnedAt: "desc" },
                { createdAt: "asc" },
            ],
            select: pendingMessageSelect,
        }),
        db.sessionPendingMessage.findMany({
            where: {
                sessionId,
                pinnedAt: null,
            },
            orderBy: {
                createdAt: "asc",
            },
            select: pendingMessageSelect,
        }),
    ]);

    return [...pinned, ...normal] as PendingMessageRecord[];
}

export async function findPendingMessageBySessionLocalId(sessionId: string, localId: string): Promise<PendingMessageRecord | null> {
    const message = await db.sessionPendingMessage.findUnique({
        where: {
            sessionId_localId: {
                sessionId,
                localId,
            },
        },
        select: pendingMessageSelect,
    });

    return message as PendingMessageRecord | null;
}

export async function findPendingMessageById(sessionId: string, pendingId: string): Promise<PendingMessageRecord | null> {
    const message = await db.sessionPendingMessage.findUnique({
        where: {
            id: pendingId,
        },
        select: pendingMessageSelect,
    });

    if (!message || message.sessionId !== sessionId) {
        return null;
    }

    return message as PendingMessageRecord;
}

export async function enqueuePendingMessage(params: {
    sessionId: string;
    localId: string;
    content: string;
    sentBy: string | null;
    sentByName: string | null;
    trackCliDelivery: boolean;
}): Promise<{ message: PendingMessageRecord; created: boolean }> {
    const existing = await findPendingMessageBySessionLocalId(params.sessionId, params.localId);
    if (existing) {
        return { message: existing, created: false };
    }

    try {
        const created = await db.sessionPendingMessage.create({
            data: {
                sessionId: params.sessionId,
                localId: params.localId,
                content: {
                    t: "encrypted",
                    c: params.content,
                },
                sentBy: params.sentBy,
                sentByName: params.sentByName,
                trackCliDelivery: params.trackCliDelivery,
            },
            select: pendingMessageSelect,
        });

        return {
            message: created as PendingMessageRecord,
            created: true,
        };
    } catch (error) {
        // A concurrent request (e.g. hedged retries sharing one localId) may have
        // inserted the same (sessionId, localId) between our check and create.
        // Treat the unique-constraint violation as idempotent: return the row the
        // other request created instead of failing.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const winner = await findPendingMessageBySessionLocalId(params.sessionId, params.localId);
            if (winner) {
                return { message: winner, created: false };
            }
        }
        throw error;
    }
}

export async function pinPendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageRecord | null> {
    const message = await findPendingMessageById(sessionId, pendingId);
    if (!message) {
        return null;
    }

    const updated = await db.sessionPendingMessage.update({
        where: {
            id: pendingId,
        },
        data: {
            pinnedAt: message.pinnedAt ? null : new Date(),
        },
        select: pendingMessageSelect,
    });

    return updated as PendingMessageRecord;
}

// Toggle the paused state of a pending message. A paused message stays in the
// session (and is still listed/synced) but is excluded from auto-dispatch — it
// behaves as a draft until resumed. Mirrors pinPendingMessage's toggle shape.
export async function pausePendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageRecord | null> {
    const message = await findPendingMessageById(sessionId, pendingId);
    if (!message) {
        return null;
    }

    const updated = await db.sessionPendingMessage.update({
        where: {
            id: pendingId,
        },
        data: {
            pausedAt: message.pausedAt ? null : new Date(),
        },
        select: pendingMessageSelect,
    });

    return updated as PendingMessageRecord;
}

// Replace the (client-encrypted) content of a pending message. The server only
// stores ciphertext: `content` is the already-encrypted string produced by the
// client, wrapped the same way as enqueue.
export async function updatePendingMessageContent(sessionId: string, pendingId: string, content: string): Promise<PendingMessageRecord | null> {
    const message = await findPendingMessageById(sessionId, pendingId);
    if (!message) {
        return null;
    }

    const updated = await db.sessionPendingMessage.update({
        where: {
            id: pendingId,
        },
        data: {
            content: {
                t: "encrypted",
                c: content,
            },
        },
        select: pendingMessageSelect,
    });

    return updated as PendingMessageRecord;
}

export async function deletePendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageRecord | null> {
    return db.$transaction(async (tx) => {
        const message = await tx.sessionPendingMessage.findUnique({
            where: {
                id: pendingId,
            },
            select: pendingMessageSelect,
        });

        if (!message || message.sessionId !== sessionId) {
            return null;
        }

        const deleted = await tx.sessionPendingMessage.deleteMany({
            where: {
                id: pendingId,
                sessionId,
            },
        });

        if (deleted.count === 0) {
            return null;
        }

        return message as PendingMessageRecord;
    });
}

export async function takeNextPendingMessageForDispatch(sessionId: string): Promise<PendingMessageRecord | null> {
    return db.$transaction(async (tx) => {
        const candidate = await tx.sessionPendingMessage.findFirst({
            where: {
                sessionId,
                // Paused messages are drafts: never auto-dispatched, never block
                // the queue. Dispatch always picks the next non-paused message.
                pausedAt: null,
            },
            orderBy: [
                { pinnedAt: { sort: "desc", nulls: "last" } },
                { createdAt: "asc" },
            ],
            select: pendingMessageSelect,
        });

        if (!candidate) {
            return null;
        }

        const deleted = await tx.sessionPendingMessage.deleteMany({
            where: {
                id: candidate.id,
                sessionId,
            },
        });

        if (deleted.count === 0) {
            return null;
        }

        return candidate as PendingMessageRecord;
    });
}
