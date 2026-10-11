-- AlterTable
ALTER TABLE "OrchestratorTask" ADD COLUMN "stderrText" TEXT;

-- AlterTable
ALTER TABLE "OrchestratorExecution" ADD COLUMN "stderrText" TEXT;
