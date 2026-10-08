CREATE TABLE "AiProject" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProjectVersion" (
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "repositoryId" BIGINT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "registeredRepoId" TEXT NOT NULL,
    "registeredKvVersion" INTEGER NOT NULL,
    "workingDirectory" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "baseCommit" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiProjectVersion_pkey" PRIMARY KEY ("projectId","version")
);

CREATE UNIQUE INDEX "AiProject_accountId_clientRequestId_key" ON "AiProject"("accountId","clientRequestId");
CREATE INDEX "AiProject_accountId_active_updatedAt_idx" ON "AiProject"("accountId","active","updatedAt");
CREATE INDEX "AiProjectVersion_repositoryId_machineId_idx" ON "AiProjectVersion"("repositoryId","machineId");
ALTER TABLE "AiProject" ADD CONSTRAINT "AiProject_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiProjectVersion" ADD CONSTRAINT "AiProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AiProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
