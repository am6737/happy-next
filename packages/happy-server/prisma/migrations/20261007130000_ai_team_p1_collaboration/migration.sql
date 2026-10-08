CREATE TABLE "AiClarification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "candidates" JSONB,
    "targetWorkItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedText" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiClarification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiClarification_accountId_conversationId_clientMessageId_key" ON "AiClarification"("accountId", "conversationId", "clientMessageId");
CREATE INDEX "AiClarification_accountId_conversationId_status_createdAt_idx" ON "AiClarification"("accountId", "conversationId", "status", "createdAt");
ALTER TABLE "AiClarification" ADD CONSTRAINT "AiClarification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrchestratorTask" ADD COLUMN "parentTaskId" TEXT,
ADD COLUMN "assignedAgentId" TEXT,
ADD COLUMN "delegationKey" TEXT,
ADD COLUMN "delegationHash" TEXT,
ADD COLUMN "delegationDepth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "collaborationRole" TEXT;
CREATE UNIQUE INDEX "OrchestratorTask_parentTaskId_delegationKey_key" ON "OrchestratorTask"("parentTaskId", "delegationKey");
CREATE INDEX "OrchestratorTask_runId_parentTaskId_idx" ON "OrchestratorTask"("runId", "parentTaskId");
ALTER TABLE "OrchestratorTask" ADD CONSTRAINT "OrchestratorTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "OrchestratorTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
