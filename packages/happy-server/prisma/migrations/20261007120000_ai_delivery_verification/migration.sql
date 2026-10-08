ALTER TABLE "AiWorkItem" ADD COLUMN "deliveryVerificationStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "AiWorkItem" ADD COLUMN "deliveryVerificationAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiWorkItem" ADD COLUMN "deliveryVerificationNextAt" TIMESTAMP(3);
ALTER TABLE "AiWorkItem" ADD COLUMN "deliveryVerifiedAt" TIMESTAMP(3);
ALTER TABLE "AiWorkItem" ADD COLUMN "deliveryVerificationErrorCode" TEXT;
CREATE INDEX "AiWorkItem_deliveryVerificationStatus_deliveryVerificationNextAt_idx" ON "AiWorkItem"("deliveryVerificationStatus", "deliveryVerificationNextAt");
