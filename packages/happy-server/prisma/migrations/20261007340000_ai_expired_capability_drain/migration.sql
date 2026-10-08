ALTER TABLE "AiExecutionCapability"
    ADD COLUMN "recoveryMode" TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE "AiCapabilityRecoveryRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "dispatchTokenHash" TEXT NOT NULL,
    "expiredCapabilityId" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestExpiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByAccountId" TEXT,
    "drainCapabilityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiCapabilityRecoveryRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiCapabilityRecoveryRequest_executionId_key"
    ON "AiCapabilityRecoveryRequest"("executionId");
CREATE INDEX "AiCapabilityRecoveryRequest_accountId_status_createdAt_idx"
    ON "AiCapabilityRecoveryRequest"("accountId", "status", "createdAt");
ALTER TABLE "AiCapabilityRecoveryRequest" ADD CONSTRAINT "AiCapabilityRecoveryRequest_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "AiWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCapabilityRecoveryRequest" ADD CONSTRAINT "AiCapabilityRecoveryRequest_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "OrchestratorExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
