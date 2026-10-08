CREATE TABLE "AiSteeringMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "targetTaskId" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSteeringMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiSteeringMessage_accountId_conversationId_clientMessageId_key" ON "AiSteeringMessage"("accountId", "conversationId", "clientMessageId");
CREATE INDEX "AiSteeringMessage_status_nextAttemptAt_idx" ON "AiSteeringMessage"("status", "nextAttemptAt");
ALTER TABLE "AiSteeringMessage" ADD CONSTRAINT "AiSteeringMessage_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "AiWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
