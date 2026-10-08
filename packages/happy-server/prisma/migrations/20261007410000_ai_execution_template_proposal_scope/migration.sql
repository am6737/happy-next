ALTER TABLE "OrchestratorExecution" ADD COLUMN "templateVersionId" TEXT;
ALTER TABLE "AiAgentTemplateProposal" ADD COLUMN "sourceExecutionId" TEXT;
CREATE INDEX "OrchestratorExecution_templateVersionId_idx"
    ON "OrchestratorExecution"("templateVersionId");
