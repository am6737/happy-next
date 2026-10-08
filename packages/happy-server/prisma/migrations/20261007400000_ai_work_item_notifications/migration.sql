CREATE TABLE "AiWorkItemNotification" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "recipientAccountId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "AiWorkItemNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiWorkItemNotification_workItemId_recipientAccountId_eventKey_key"
    ON "AiWorkItemNotification"("workItemId", "recipientAccountId", "eventKey");
CREATE INDEX "AiWorkItemNotification_recipientAccountId_createdAt_id_idx"
    ON "AiWorkItemNotification"("recipientAccountId", "createdAt" DESC, "id" DESC);
ALTER TABLE "AiWorkItemNotification" ADD CONSTRAINT "AiWorkItemNotification_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES "AiWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
