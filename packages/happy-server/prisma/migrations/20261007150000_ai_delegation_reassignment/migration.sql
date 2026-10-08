ALTER TABLE "OrchestratorTask" ADD COLUMN "delegationRequirements" TEXT;
CREATE TABLE "AiDelegationAudit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "toAgentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDelegationAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiDelegationAudit_accountId_taskId_createdAt_idx" ON "AiDelegationAudit"("accountId", "taskId", "createdAt");
ALTER TABLE "AiDelegationAudit" ADD CONSTRAINT "AiDelegationAudit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestratorTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
