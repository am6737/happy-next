CREATE TABLE "AiDecisionRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "workItemId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "dispatchTokenHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedBy" TEXT,
  "clientRequestId" TEXT,
  "decision" TEXT,
  "note" TEXT,
  "decidedAt" TIMESTAMP(3),
  "deliveryStatus" TEXT NOT NULL DEFAULT 'none',
  "claimOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiDecisionRequest_executionId_kind_key" ON "AiDecisionRequest"("executionId", "kind");
CREATE INDEX "AiDecisionRequest_workspaceId_status_createdAt_idx" ON "AiDecisionRequest"("workspaceId", "status", "createdAt");
CREATE INDEX "AiDecisionRequest_deliveryStatus_nextAttemptAt_idx" ON "AiDecisionRequest"("deliveryStatus", "nextAttemptAt");
