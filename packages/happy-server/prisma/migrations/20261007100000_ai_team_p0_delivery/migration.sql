ALTER TABLE "AiMessage" ADD COLUMN "clientMessageId" TEXT;
ALTER TABLE "AiWorkItem" ADD COLUMN "pullRequestEventAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "AiMessage_conversationId_clientMessageId_key" ON "AiMessage"("conversationId", "clientMessageId");

ALTER TABLE "GithubWebhookDelivery" ADD COLUMN "payloadHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GithubWebhookDelivery" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'failed';
ALTER TABLE "GithubWebhookDelivery" ADD COLUMN "claimOwner" TEXT;
ALTER TABLE "GithubWebhookDelivery" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "GithubWebhookDelivery" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GithubWebhookDelivery" ADD COLUMN "processedAt" TIMESTAMP(3);

CREATE TABLE "AiGithubRepositoryGrant" (
  "accountId" TEXT NOT NULL,
  "repositoryId" BIGINT NOT NULL,
  "fullName" TEXT NOT NULL,
  "installationId" BIGINT,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiGithubRepositoryGrant_pkey" PRIMARY KEY ("accountId", "repositoryId")
);
CREATE INDEX "AiGithubRepositoryGrant_repositoryId_installationId_idx" ON "AiGithubRepositoryGrant"("repositoryId", "installationId");

CREATE TABLE "AiInboundRequest" (
  "accountId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "clientMessageId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "claimOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiInboundRequest_pkey" PRIMARY KEY ("accountId", "conversationId", "clientMessageId")
);

CREATE TABLE "AiGithubIssueIntent" (
  "accountId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "clientMessageId" TEXT NOT NULL,
  "repositoryId" BIGINT NOT NULL,
  "owner" TEXT NOT NULL,
  "repo" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "issueNumber" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiGithubIssueIntent_pkey" PRIMARY KEY ("accountId", "conversationId", "clientMessageId")
);
