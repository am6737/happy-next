CREATE TABLE "AiWorkspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "authRevision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiWorkspace_ownerAccountId_key" UNIQUE ("ownerAccountId"),
  CONSTRAINT "AiWorkspace_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account"("id") ON DELETE CASCADE
);
CREATE TABLE "AiWorkspaceMembership" (
  "workspaceId" TEXT NOT NULL,
  "memberAccountId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("workspaceId", "memberAccountId"),
  CONSTRAINT "AiWorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AiWorkspace"("id") ON DELETE CASCADE,
  CONSTRAINT "AiWorkspaceMembership_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "Account"("id") ON DELETE CASCADE
);
CREATE INDEX "AiWorkspaceMembership_memberAccountId_role_idx" ON "AiWorkspaceMembership"("memberAccountId", "role");
CREATE TABLE "AiWorkspaceGrant" (
  "workspaceId" TEXT NOT NULL,
  "memberAccountId" TEXT NOT NULL,
  "resourceKind" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canRun" BOOLEAN NOT NULL DEFAULT false,
  "canApprove" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("workspaceId", "memberAccountId", "resourceKind", "resourceId"),
  CONSTRAINT "AiWorkspaceGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AiWorkspace"("id") ON DELETE CASCADE,
  CONSTRAINT "AiWorkspaceGrant_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "Account"("id") ON DELETE CASCADE
);
CREATE INDEX "AiWorkspaceGrant_memberAccountId_resourceKind_resourceId_idx" ON "AiWorkspaceGrant"("memberAccountId", "resourceKind", "resourceId");
CREATE TABLE "AiExecutionCapability" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "projectId" TEXT,
  "projectVersion" INTEGER,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "allowedOps" TEXT[] NOT NULL,
  "authRevision" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiExecutionCapability_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AiWorkspace"("id") ON DELETE CASCADE,
  CONSTRAINT "AiExecutionCapability_tokenHash_key" UNIQUE ("tokenHash")
);
CREATE INDEX "AiExecutionCapability_executionId_expiresAt_idx" ON "AiExecutionCapability"("executionId", "expiresAt");
CREATE INDEX "AiExecutionCapability_workspaceId_revokedAt_idx" ON "AiExecutionCapability"("workspaceId", "revokedAt");
