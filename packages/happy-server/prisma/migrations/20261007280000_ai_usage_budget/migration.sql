CREATE TABLE "AiBudgetPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "projectId" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "limitMicros" BIGINT NOT NULL,
  "perRunReserveMicros" BIGINT NOT NULL,
  "usedMicros" BIGINT NOT NULL DEFAULT 0,
  "reservedMicros" BIGINT NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiBudgetPolicy_scopeKey_key" UNIQUE ("scopeKey"),
  CONSTRAINT "AiBudgetPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AiWorkspace"("id") ON DELETE CASCADE
);
CREATE INDEX "AiBudgetPolicy_workspaceId_active_periodEnd_idx" ON "AiBudgetPolicy"("workspaceId", "active", "periodEnd");
CREATE TABLE "AiBudgetReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "reserveMicros" BIGINT NOT NULL,
  "policyRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "actualMicros" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "AiBudgetReservation_runId_key" UNIQUE ("runId"),
  CONSTRAINT "AiBudgetReservation_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AiBudgetPolicy"("id") ON DELETE CASCADE
);
CREATE INDEX "AiBudgetReservation_policyId_status_idx" ON "AiBudgetReservation"("policyId", "status");
CREATE TABLE "AiUsageDelta" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "costMicros" BIGINT,
  "pricingVersion" TEXT,
  "measuredAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageDelta_executionId_sourceEventId_key" UNIQUE ("executionId", "sourceEventId")
);
CREATE INDEX "AiUsageDelta_accountId_executionId_measuredAt_idx" ON "AiUsageDelta"("accountId", "executionId", "measuredAt");
