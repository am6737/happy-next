-- AlterTable
ALTER TABLE "OrchestratorTask" ADD COLUMN "transferResult" JSONB;

-- AlterTable
ALTER TABLE "OrchestratorExecution" ADD COLUMN "transferResult" JSONB;
