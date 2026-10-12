-- AlterTable
ALTER TABLE "OrchestratorTask" ADD COLUMN "stderrFile" JSONB,
ADD COLUMN "stdoutFile" JSONB;

-- AlterTable
ALTER TABLE "OrchestratorExecution" ADD COLUMN "stderrFile" JSONB,
ADD COLUMN "stdoutFile" JSONB;
