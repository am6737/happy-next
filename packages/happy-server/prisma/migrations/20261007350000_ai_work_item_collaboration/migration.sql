ALTER TABLE "AiWorkItem"
    ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "dueDate" TIMESTAMP(3),
    ADD COLUMN "metadataRevision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AiWorkItemComment" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiWorkItemComment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiWorkItemComment_workItemId_actorAccountId_clientRequestId_key"
    ON "AiWorkItemComment"("workItemId", "actorAccountId", "clientRequestId");
CREATE INDEX "AiWorkItemComment_workItemId_createdAt_id_idx"
    ON "AiWorkItemComment"("workItemId", "createdAt", "id");
ALTER TABLE "AiWorkItemComment" ADD CONSTRAINT "AiWorkItemComment_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES "AiWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiWorkItemSubscription" (
    "workItemId" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiWorkItemSubscription_pkey" PRIMARY KEY ("workItemId","actorAccountId")
);
ALTER TABLE "AiWorkItemSubscription" ADD CONSTRAINT "AiWorkItemSubscription_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES "AiWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiWorkItemAudit" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiWorkItemAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiWorkItemAudit_workItemId_createdAt_id_idx"
    ON "AiWorkItemAudit"("workItemId", "createdAt", "id");
ALTER TABLE "AiWorkItemAudit" ADD CONSTRAINT "AiWorkItemAudit_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES "AiWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
