ALTER TABLE "Teammate" ADD COLUMN "contextBudgetTokens" INTEGER;
ALTER TABLE "Teammate" ADD COLUMN "contextAutoRollover" BOOLEAN NOT NULL DEFAULT true;
