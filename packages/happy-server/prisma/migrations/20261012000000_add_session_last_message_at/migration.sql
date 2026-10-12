-- AlterTable
ALTER TABLE "Session" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

-- Backfill from the newest stored message
UPDATE "Session" AS s
SET "lastMessageAt" = m."maxCreatedAt"
FROM (
    SELECT "sessionId", MAX("createdAt") AS "maxCreatedAt"
    FROM "SessionMessage"
    GROUP BY "sessionId"
) AS m
WHERE s."id" = m."sessionId";
