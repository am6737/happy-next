CREATE TABLE "AiSkill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "currentVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSkill_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiSkillVersion" (
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSkillVersion_pkey" PRIMARY KEY ("skillId","version")
);
CREATE TABLE "AiSkillFile" (
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    CONSTRAINT "AiSkillFile_pkey" PRIMARY KEY ("skillId","version","path")
);
CREATE TABLE "AiSkillAgentBinding" (
    "skillId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSkillAgentBinding_pkey" PRIMARY KEY ("skillId","agentId")
);
CREATE TABLE "AiSkillProposal" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "AiSkillProposal_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiTaskSkillSnapshot" (
    "taskId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiTaskSkillSnapshot_pkey" PRIMARY KEY ("taskId","skillId")
);
CREATE UNIQUE INDEX "AiSkill_accountId_name_key" ON "AiSkill"("accountId","name");
CREATE INDEX "AiSkill_accountId_teamId_idx" ON "AiSkill"("accountId","teamId");
CREATE INDEX "AiSkillAgentBinding_accountId_agentId_idx" ON "AiSkillAgentBinding"("accountId","agentId");
CREATE INDEX "AiSkillProposal_accountId_status_createdAt_idx" ON "AiSkillProposal"("accountId","status","createdAt");
ALTER TABLE "AiSkill" ADD CONSTRAINT "AiSkill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSkillVersion" ADD CONSTRAINT "AiSkillVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AiSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSkillFile" ADD CONSTRAINT "AiSkillFile_skillId_version_fkey" FOREIGN KEY ("skillId","version") REFERENCES "AiSkillVersion"("skillId","version") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSkillAgentBinding" ADD CONSTRAINT "AiSkillAgentBinding_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AiSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSkillProposal" ADD CONSTRAINT "AiSkillProposal_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AiSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTaskSkillSnapshot" ADD CONSTRAINT "AiTaskSkillSnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OrchestratorTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
