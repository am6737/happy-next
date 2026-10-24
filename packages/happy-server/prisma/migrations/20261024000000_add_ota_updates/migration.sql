-- CreateTable
CREATE TABLE "OtaAsset" (
    "hash" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtaAsset_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "OtaUpdate" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "runtimeVersion" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" JSONB,
    "message" TEXT,
    "gitCommit" TEXT,
    "republishedFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtaUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtaUpdate_channel_platform_runtimeVersion_createdAt_idx" ON "OtaUpdate"("channel", "platform", "runtimeVersion", "createdAt");

