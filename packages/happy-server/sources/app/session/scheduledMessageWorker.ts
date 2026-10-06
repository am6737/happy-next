import { eventRouter } from "@/app/events/eventRouter";
import { dispatchNextPendingIfPossible } from "@/app/session/pendingMessageAutoDispatch";
import { listSessionIdsWithDueScheduledMessages } from "@/app/session/pendingMessageService";
import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { warn } from "@/utils/log";
import { shutdownSignal } from "@/utils/shutdown";

export const SCHEDULED_MESSAGE_SCAN_INTERVAL_MS = 5_000;

// Scans for scheduled messages whose time has arrived and hands each affected
// session to the normal auto-dispatch path, which still respects the turn state
// (a busy session keeps the message queued until its turn ends). A session whose
// CLI is offline is skipped so the message stays pending instead of being sent
// into the void; it goes out on a later scan once the CLI reconnects.
async function dispatchDueScheduledMessages(): Promise<void> {
    const sessionIds = await listSessionIdsWithDueScheduledMessages();
    for (const sessionId of sessionIds) {
        const session = await db.session.findUnique({
            where: { id: sessionId },
            select: { accountId: true },
        });
        if (!session) {
            continue;
        }

        const connections = eventRouter.getConnections(session.accountId);
        const cliOnline = !!connections && Array.from(connections).some((connection) => (
            connection.connectionType === "session-scoped" && connection.sessionId === sessionId
        ));
        if (!cliOnline) {
            continue;
        }

        try {
            await dispatchNextPendingIfPossible({ ownerId: session.accountId, sessionId });
        } catch (error) {
            warn({ module: "scheduled-message-worker", sessionId }, `Dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

export function startScheduledMessageWorker(): void {
    forever("scheduled-message-worker", async () => {
        await dispatchDueScheduledMessages();
        await delay(SCHEDULED_MESSAGE_SCAN_INTERVAL_MS, shutdownSignal);
    });
}
