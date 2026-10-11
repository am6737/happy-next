ALTER TABLE "Teammate" ADD COLUMN "timezone" TEXT;
ALTER TABLE "TeammateTask" ADD COLUMN "createdByTeammateId" TEXT;
CREATE INDEX "TeammateTask_createdByTeammateId_createdAt_idx" ON "TeammateTask"("createdByTeammateId", "createdAt");
