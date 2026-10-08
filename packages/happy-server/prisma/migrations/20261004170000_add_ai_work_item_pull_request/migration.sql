ALTER TABLE "AiWorkItem"
  ADD COLUMN "pullRequestUrl" TEXT,
  ADD COLUMN "pullRequestNumber" INTEGER,
  ADD COLUMN "pullRequestState" TEXT,
  ADD COLUMN "pullRequestMergedAt" TIMESTAMP(3);

CREATE INDEX "AiWorkItem_sourceType_pullRequestNumber_idx"
  ON "AiWorkItem"("sourceType", "pullRequestNumber");
