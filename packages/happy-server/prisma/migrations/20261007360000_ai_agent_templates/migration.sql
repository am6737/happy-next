CREATE TABLE "AiAgentTemplate" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAgentTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiAgentTemplate_accountId_name_key" ON "AiAgentTemplate"("accountId", "name");
CREATE INDEX "AiAgentTemplate_accountId_updatedAt_idx" ON "AiAgentTemplate"("accountId", "updatedAt" DESC);

CREATE TABLE "AiAgentTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAgentTemplateVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiAgentTemplateVersion_templateId_version_key" ON "AiAgentTemplateVersion"("templateId", "version");
ALTER TABLE "AiAgentTemplateVersion" ADD CONSTRAINT "AiAgentTemplateVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "AiAgentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAgent" ADD COLUMN "templateVersionId" TEXT;
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_templateVersionId_fkey"
  FOREIGN KEY ("templateVersionId") REFERENCES "AiAgentTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
