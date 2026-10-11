ALTER TABLE "TeammateTask" ADD COLUMN "reviewerTeammateId" TEXT;
ALTER TABLE "TeammateTask" ADD COLUMN "parentTaskId" TEXT;
ALTER TABLE "TeammateTask" ADD COLUMN "reviewRound" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "TeammateTask_parentTaskId_idx" ON "TeammateTask"("parentTaskId");
