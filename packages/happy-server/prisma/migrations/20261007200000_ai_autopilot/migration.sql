CREATE TABLE "AiAutopilot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "teamId" TEXT,
    "conversationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "cronExpression" TEXT,
    "timezone" TEXT,
    "webhookSecret" BYTEA,
    "action" TEXT NOT NULL,
    "concurrencyPolicy" TEXT NOT NULL,
    "catchupLimit" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastPlannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAutopilot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiAutopilotRun" (
    "id" TEXT NOT NULL,
    "autopilotId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "orchestratorRunId" TEXT,
    "workItemId" TEXT,
    "issueResourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAutopilotRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiAutopilot_accountId_enabled_triggerKind_idx" ON "AiAutopilot"("accountId","enabled","triggerKind");
CREATE UNIQUE INDEX "AiAutopilotRun_autopilotId_triggerKey_key" ON "AiAutopilotRun"("autopilotId","triggerKey");
CREATE INDEX "AiAutopilotRun_status_nextAttemptAt_idx" ON "AiAutopilotRun"("status","nextAttemptAt");
CREATE INDEX "AiAutopilotRun_autopilotId_plannedAt_idx" ON "AiAutopilotRun"("autopilotId","plannedAt");
ALTER TABLE "AiAutopilot" ADD CONSTRAINT "AiAutopilot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAutopilotRun" ADD CONSTRAINT "AiAutopilotRun_autopilotId_fkey" FOREIGN KEY ("autopilotId") REFERENCES "AiAutopilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
