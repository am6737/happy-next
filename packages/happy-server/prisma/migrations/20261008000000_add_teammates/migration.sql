-- CreateTable
CREATE TABLE "Teammate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" JSONB,
    "role" TEXT NOT NULL DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT NOT NULL DEFAULT '',
    "machineId" TEXT NOT NULL,
    "workerProvider" TEXT NOT NULL DEFAULT 'claude',
    "model" TEXT,
    "workerPermissionMode" TEXT NOT NULL DEFAULT 'default',
    "maxConcurrentRuns" INTEGER NOT NULL DEFAULT 3,
    "monthlyBudgetUsd" DOUBLE PRECISION,
    "heartbeatIntervalMin" INTEGER,
    "activeHours" JSONB,
    "dreamingHour" INTEGER,
    "canSelfAssign" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teammate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeammateThread" (
    "id" TEXT NOT NULL,
    "teammateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelId" TEXT,
    "taskId" TEXT,
    "providerSessionId" TEXT,
    "currentSessionId" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeammateThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeammateRun" (
    "id" TEXT NOT NULL,
    "teammateId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "eventPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "dispatchToken" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "failureReason" TEXT,
    "sessionId" TEXT,
    "taskId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TeammateRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeammateSession" (
    "sessionId" TEXT NOT NULL,
    "teammateId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeammateSession_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "TeammateTask" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "teammateId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "resourceId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "summary" TEXT,
    "prUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeammateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "memberType" TEXT NOT NULL,
    "accountId" TEXT,
    "teammateId" TEXT,
    "encryptedDataKey" BYTEA NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "localId" TEXT,
    "senderType" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" TEXT NOT NULL DEFAULT 'text',
    "taskId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Teammate_accountId_createdAt_idx" ON "Teammate"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Teammate_accountId_handle_key" ON "Teammate"("accountId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "TeammateThread_teammateId_channelId_key" ON "TeammateThread"("teammateId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "TeammateThread_teammateId_taskId_key" ON "TeammateThread"("teammateId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TeammateRun_dispatchToken_key" ON "TeammateRun"("dispatchToken");

-- CreateIndex
CREATE INDEX "TeammateRun_teammateId_status_idx" ON "TeammateRun"("teammateId", "status");

-- CreateIndex
CREATE INDEX "TeammateRun_threadId_status_idx" ON "TeammateRun"("threadId", "status");

-- CreateIndex
CREATE INDEX "TeammateRun_teammateId_queuedAt_idx" ON "TeammateRun"("teammateId", "queuedAt");

-- CreateIndex
CREATE INDEX "TeammateSession_teammateId_idx" ON "TeammateSession"("teammateId");

-- CreateIndex
CREATE INDEX "TeammateSession_threadId_idx" ON "TeammateSession"("threadId");

-- CreateIndex
CREATE INDEX "TeammateTask_accountId_resourceId_idx" ON "TeammateTask"("accountId", "resourceId");

-- CreateIndex
CREATE INDEX "TeammateTask_teammateId_updatedAt_idx" ON "TeammateTask"("teammateId", "updatedAt");

-- CreateIndex
CREATE INDEX "Channel_accountId_idx" ON "Channel"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMember_channelId_accountId_key" ON "ChannelMember"("channelId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMember_channelId_teammateId_key" ON "ChannelMember"("channelId", "teammateId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessage_channelId_localId_key" ON "ChannelMessage"("channelId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessage_channelId_seq_key" ON "ChannelMessage"("channelId", "seq");

-- AddForeignKey
ALTER TABLE "Teammate" ADD CONSTRAINT "Teammate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateThread" ADD CONSTRAINT "TeammateThread_teammateId_fkey" FOREIGN KEY ("teammateId") REFERENCES "Teammate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateThread" ADD CONSTRAINT "TeammateThread_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateThread" ADD CONSTRAINT "TeammateThread_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TeammateTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateRun" ADD CONSTRAINT "TeammateRun_teammateId_fkey" FOREIGN KEY ("teammateId") REFERENCES "Teammate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateRun" ADD CONSTRAINT "TeammateRun_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TeammateThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateRun" ADD CONSTRAINT "TeammateRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TeammateTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateSession" ADD CONSTRAINT "TeammateSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateSession" ADD CONSTRAINT "TeammateSession_teammateId_fkey" FOREIGN KEY ("teammateId") REFERENCES "Teammate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateSession" ADD CONSTRAINT "TeammateSession_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TeammateThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateSession" ADD CONSTRAINT "TeammateSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TeammateTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateTask" ADD CONSTRAINT "TeammateTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeammateTask" ADD CONSTRAINT "TeammateTask_teammateId_fkey" FOREIGN KEY ("teammateId") REFERENCES "Teammate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_teammateId_fkey" FOREIGN KEY ("teammateId") REFERENCES "Teammate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TeammateTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TeammateRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

