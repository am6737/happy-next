CREATE TABLE "AiIntegrationVerification" (
    "executionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "proof" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "expectedHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiIntegrationVerification_pkey" PRIMARY KEY ("executionId")
);

CREATE INDEX "AiIntegrationVerification_status_nextAttemptAt_idx" ON "AiIntegrationVerification"("status", "nextAttemptAt");
CREATE INDEX "AiIntegrationVerification_accountId_runId_taskId_idx" ON "AiIntegrationVerification"("accountId", "runId", "taskId");
ALTER TABLE "AiIntegrationVerification" ADD CONSTRAINT "AiIntegrationVerification_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "OrchestratorExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
