CREATE TABLE "AiPersistentExecutionEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "redactedSummary" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "redactedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiPersistentExecutionEvent_executionId_eventId_key" UNIQUE ("executionId", "eventId"),
  CONSTRAINT "AiPersistentExecutionEvent_executionId_seq_key" UNIQUE ("executionId", "seq")
);
CREATE INDEX "AiPersistentExecutionEvent_accountId_executionId_seq_idx" ON "AiPersistentExecutionEvent"("accountId", "executionId", "seq");
CREATE INDEX "AiPersistentExecutionEvent_createdAt_redactedAt_idx" ON "AiPersistentExecutionEvent"("createdAt", "redactedAt");
