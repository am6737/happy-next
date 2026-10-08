CREATE TABLE "AiAgentTemplateProposal" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "sourceAgentId" TEXT,
    "expectedCurrentVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByAccountId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAgentTemplateProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAgentTemplateProposal_templateId_actorAccountId_clientRequestId_key"
    ON "AiAgentTemplateProposal"("templateId", "actorAccountId", "clientRequestId");
CREATE INDEX "AiAgentTemplateProposal_templateId_status_createdAt_idx"
    ON "AiAgentTemplateProposal"("templateId", "status", "createdAt" DESC);
ALTER TABLE "AiAgentTemplateProposal" ADD CONSTRAINT "AiAgentTemplateProposal_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "AiAgentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
