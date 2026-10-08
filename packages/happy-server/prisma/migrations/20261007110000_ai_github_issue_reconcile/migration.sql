ALTER TABLE "AiGithubIssueIntent" ADD COLUMN "reconcileOwner" TEXT;
ALTER TABLE "AiGithubIssueIntent" ADD COLUMN "reconcileLeaseUntil" TIMESTAMP(3);
ALTER TABLE "AiGithubIssueIntent" ADD COLUMN "reconcileAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiGithubIssueIntent" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
ALTER TABLE "AiGithubIssueIntent" ADD COLUMN "lastErrorCode" TEXT;
CREATE INDEX "AiGithubIssueIntent_status_lastCheckedAt_idx" ON "AiGithubIssueIntent"("status", "lastCheckedAt");
