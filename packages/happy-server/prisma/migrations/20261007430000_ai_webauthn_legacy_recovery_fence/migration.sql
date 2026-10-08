UPDATE "AiExecutionCapability" c
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE c."recoveryMode" = 'drain' AND c."revokedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AiCapabilityRecoveryRequest" rr
    JOIN "AiCapabilityRecoveryAudit" proof
      ON proof."recoveryId" = rr.id AND proof.generation = rr.generation
     AND proof.action LIKE 'human_verified:%'
    WHERE rr."drainCapabilityId" = c.id
  );

UPDATE "AiCapabilityRecoveryRequest" rr
SET generation = rr.generation + 1,
    status = 'pending',
    "requestExpiresAt" = CURRENT_TIMESTAMP + interval '15 minutes',
    "confirmedAt" = NULL,
    "confirmedByAccountId" = NULL,
    "drainCapabilityId" = NULL
WHERE rr.status = 'confirmed'
  AND NOT EXISTS (
    SELECT 1 FROM "AiCapabilityRecoveryAudit" proof
    WHERE proof."recoveryId" = rr.id AND proof.generation = rr.generation
      AND proof.action LIKE 'human_verified:%'
  );

INSERT INTO "AiCapabilityRecoveryAudit"
    (id, "recoveryId", generation, action, "actorAccountId")
SELECT md5(rr.id || ':' || rr.generation || ':legacy_confirmation_invalidated'),
       rr.id, rr.generation, 'legacy_confirmation_invalidated', rr."accountId"
FROM "AiCapabilityRecoveryRequest" rr
WHERE rr.status = 'pending' AND rr.generation > 1
  AND NOT EXISTS (
    SELECT 1 FROM "AiCapabilityRecoveryAudit" audit
    WHERE audit."recoveryId" = rr.id AND audit.generation = rr.generation
  )
ON CONFLICT ("recoveryId", generation, action) DO NOTHING;
