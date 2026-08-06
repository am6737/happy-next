CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL,
    "kind" TEXT,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "messageLocalId" TEXT,
    "committedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cleanupStartedAt" TIMESTAMP(3),
    "width" INTEGER,
    "height" INTEGER,
    "thumbhash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatAttachment_path_key" ON "ChatAttachment"("path");
CREATE INDEX "ChatAttachment_accountId_idx" ON "ChatAttachment"("accountId");
CREATE INDEX "ChatAttachment_accountId_committedAt_idx" ON "ChatAttachment"("accountId", "committedAt");
CREATE INDEX "ChatAttachment_sessionId_idx" ON "ChatAttachment"("sessionId");
CREATE INDEX "ChatAttachment_sessionId_committedAt_idx" ON "ChatAttachment"("sessionId", "committedAt");
CREATE INDEX "ChatAttachment_sessionId_messageLocalId_idx" ON "ChatAttachment"("sessionId", "messageLocalId");
CREATE INDEX "ChatAttachment_committedAt_expiresAt_cleanupStartedAt_idx" ON "ChatAttachment"("committedAt", "expiresAt", "cleanupStartedAt");
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AttachmentObjectDeletion" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttachmentObjectDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttachmentObjectDeletion_path_key" ON "AttachmentObjectDeletion"("path");
CREATE INDEX "AttachmentObjectDeletion_nextAttemptAt_claimedAt_idx" ON "AttachmentObjectDeletion"("nextAttemptAt", "claimedAt");
