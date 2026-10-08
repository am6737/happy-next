CREATE TABLE "GithubWebhookDelivery" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GithubWebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GithubWebhookDelivery_receivedAt_idx" ON "GithubWebhookDelivery"("receivedAt");
