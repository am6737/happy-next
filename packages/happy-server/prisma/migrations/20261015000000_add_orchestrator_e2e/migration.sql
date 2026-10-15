-- AlterTable
ALTER TABLE "Machine" ADD COLUMN "orchestratorKey" TEXT;

-- AlterTable
ALTER TABLE "OrchestratorTask" ADD COLUMN "sealedResult" TEXT;

-- AlterTable
ALTER TABLE "OrchestratorExecution" ADD COLUMN "sealedResult" TEXT;
