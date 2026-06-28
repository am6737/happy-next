-- AlterTable
ALTER TABLE "SessionPendingMessage" ADD COLUMN "pausedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SessionPendingMessage_sessionId_pausedAt_pinnedAt_createdAt_idx" ON "SessionPendingMessage"("sessionId", "pausedAt", "pinnedAt", "createdAt");
