ALTER TABLE "AiDecisionRequest"
  ADD COLUMN "operationId" TEXT,
  ADD COLUMN "actionType" TEXT,
  ADD COLUMN "actionHash" TEXT,
  ADD COLUMN "childSessionId" TEXT,
  ADD COLUMN "worktreePathHash" TEXT,
  ADD COLUMN "branchName" TEXT;

DROP INDEX "AiDecisionRequest_executionId_kind_key";
CREATE UNIQUE INDEX "AiDecisionRequest_executionId_operationId_key"
  ON "AiDecisionRequest"("executionId", "operationId");
CREATE UNIQUE INDEX "AiDecisionRequest_legacy_execution_kind_key"
  ON "AiDecisionRequest"("executionId", "kind") WHERE "operationId" IS NULL;
