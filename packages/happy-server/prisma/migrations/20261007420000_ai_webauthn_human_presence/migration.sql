CREATE TABLE "AiHumanCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trustedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "AiHumanCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiHumanCredential_credentialId_key" ON "AiHumanCredential"("credentialId");
CREATE INDEX "AiHumanCredential_accountId_status_createdAt_idx"
    ON "AiHumanCredential"("accountId", "status", "createdAt" DESC);
ALTER TABLE "AiHumanCredential" ADD CONSTRAINT "AiHumanCredential_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiWebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "challengeHash" TEXT NOT NULL,
    "recoveryId" TEXT,
    "generation" INTEGER,
    "action" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiWebAuthnChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiWebAuthnChallenge_challengeHash_key" ON "AiWebAuthnChallenge"("challengeHash");
CREATE INDEX "AiWebAuthnChallenge_accountId_purpose_expiresAt_idx"
    ON "AiWebAuthnChallenge"("accountId", "purpose", "expiresAt");
CREATE INDEX "AiWebAuthnChallenge_recoveryId_generation_purpose_idx"
    ON "AiWebAuthnChallenge"("recoveryId", "generation", "purpose");
ALTER TABLE "AiWebAuthnChallenge" ADD CONSTRAINT "AiWebAuthnChallenge_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiHumanCredentialTrustAudit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "approvalNonce" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiHumanCredentialTrustAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiHumanCredentialTrustAudit_approvalNonce_key"
    ON "AiHumanCredentialTrustAudit"("approvalNonce");
CREATE INDEX "AiHumanCredentialTrustAudit_accountId_credentialId_createdAt_idx"
    ON "AiHumanCredentialTrustAudit"("accountId", "credentialId", "createdAt" DESC);
ALTER TABLE "AiHumanCredentialTrustAudit" ADD CONSTRAINT "AiHumanCredentialTrustAudit_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
