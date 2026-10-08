ALTER TABLE "AiWorkItem" ADD COLUMN "projectId" TEXT;
ALTER TABLE "AiWorkItem" ADD COLUMN "projectVersion" INTEGER;
CREATE INDEX "AiWorkItem_accountId_projectId_projectVersion_idx" ON "AiWorkItem"("accountId","projectId","projectVersion");
