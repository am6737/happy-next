ALTER TABLE "OrchestratorTask" ADD COLUMN "permissionMode" TEXT;

CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "responsibilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTeam" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "currentGoal" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "leaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTeamMember" (
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiTeamMember_pkey" PRIMARY KEY ("teamId", "agentId")
);

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "teamId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "agentId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiWorkItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceResourceId" TEXT NOT NULL,
    "acceptanceStatus" TEXT NOT NULL DEFAULT 'pending',
    "requiresDecision" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT NOT NULL,
    "teamId" TEXT,
    "conversationId" TEXT NOT NULL,
    "orchestratorRunId" TEXT NOT NULL,
    "orchestratorTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiWorkItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAgent_accountId_name_key" ON "AiAgent"("accountId", "name");
CREATE INDEX "AiAgent_accountId_updatedAt_idx" ON "AiAgent"("accountId", "updatedAt" DESC);
CREATE UNIQUE INDEX "AiTeam_accountId_name_key" ON "AiTeam"("accountId", "name");
CREATE INDEX "AiTeam_accountId_updatedAt_idx" ON "AiTeam"("accountId", "updatedAt" DESC);
CREATE INDEX "AiTeamMember_agentId_idx" ON "AiTeamMember"("agentId");
CREATE UNIQUE INDEX "AiConversation_accountId_scopeKey_key" ON "AiConversation"("accountId", "scopeKey");
CREATE INDEX "AiConversation_accountId_updatedAt_idx" ON "AiConversation"("accountId", "updatedAt" DESC);
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
CREATE UNIQUE INDEX "AiWorkItem_orchestratorRunId_key" ON "AiWorkItem"("orchestratorRunId");
CREATE UNIQUE INDEX "AiWorkItem_orchestratorTaskId_key" ON "AiWorkItem"("orchestratorTaskId");
CREATE INDEX "AiWorkItem_accountId_updatedAt_idx" ON "AiWorkItem"("accountId", "updatedAt" DESC);
CREATE INDEX "AiWorkItem_assigneeId_updatedAt_idx" ON "AiWorkItem"("assigneeId", "updatedAt" DESC);
CREATE INDEX "AiWorkItem_conversationId_createdAt_idx" ON "AiWorkItem"("conversationId", "createdAt");

ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTeam" ADD CONSTRAINT "AiTeam_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTeam" ADD CONSTRAINT "AiTeam_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "AiAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiTeamMember" ADD CONSTRAINT "AiTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AiTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTeamMember" ADD CONSTRAINT "AiTeamMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AiTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiWorkItem" ADD CONSTRAINT "AiWorkItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiWorkItem" ADD CONSTRAINT "AiWorkItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "AiAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiWorkItem" ADD CONSTRAINT "AiWorkItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AiTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiWorkItem" ADD CONSTRAINT "AiWorkItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiWorkItem" ADD CONSTRAINT "AiWorkItem_orchestratorRunId_fkey" FOREIGN KEY ("orchestratorRunId") REFERENCES "OrchestratorRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
