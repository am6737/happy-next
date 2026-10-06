-- AlterTable
ALTER TABLE "SessionPendingMessage" ADD COLUMN "deliverAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SessionPendingMessage_deliverAt_pausedAt_idx" ON "SessionPendingMessage"("deliverAt", "pausedAt");
