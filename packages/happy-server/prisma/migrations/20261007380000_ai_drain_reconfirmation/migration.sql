ALTER TABLE "AiCapabilityRecoveryRequest" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "AiCapabilityRecoveryAudit" (
  "id" TEXT NOT NULL,
  "recoveryId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCapabilityRecoveryAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiCapabilityRecoveryAudit_recoveryId_generation_action_key"
  ON "AiCapabilityRecoveryAudit"("recoveryId", "generation", "action");
CREATE INDEX "AiCapabilityRecoveryAudit_actorAccountId_createdAt_idx"
  ON "AiCapabilityRecoveryAudit"("actorAccountId", "createdAt" DESC);
ALTER TABLE "AiCapabilityRecoveryAudit" ADD CONSTRAINT "AiCapabilityRecoveryAudit_recoveryId_fkey"
  FOREIGN KEY ("recoveryId") REFERENCES "AiCapabilityRecoveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "AiCapabilityRecoveryAudit" ("id", "recoveryId", "generation", "action", "actorAccountId", "createdAt")
SELECT 'legacy-' || id || '-requested', id, 1, 'requested', "accountId", "createdAt"
FROM "AiCapabilityRecoveryRequest";
INSERT INTO "AiCapabilityRecoveryAudit" ("id", "recoveryId", "generation", "action", "actorAccountId", "createdAt")
SELECT 'legacy-' || id || '-confirmed', id, 1, 'confirmed', "confirmedByAccountId", "confirmedAt"
FROM "AiCapabilityRecoveryRequest" WHERE "confirmedAt" IS NOT NULL AND "confirmedByAccountId" IS NOT NULL;
INSERT INTO "AiCapabilityRecoveryAudit" ("id", "recoveryId", "generation", "action", "actorAccountId", "createdAt")
SELECT 'legacy-' || id || '-claimed', id, 1, 'claimed', "accountId", "updatedAt"
FROM "AiCapabilityRecoveryRequest" WHERE "drainCapabilityId" IS NOT NULL;
