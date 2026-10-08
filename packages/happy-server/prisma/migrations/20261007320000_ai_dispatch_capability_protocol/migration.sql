ALTER TABLE "OrchestratorExecution"
  ADD COLUMN "capabilityProtocolVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "capabilityAllowedOps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
