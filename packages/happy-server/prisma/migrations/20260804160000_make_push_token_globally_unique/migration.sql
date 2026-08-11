BEGIN;

LOCK TABLE "AccountPushToken" IN ACCESS EXCLUSIVE MODE;

WITH "ranked_tokens" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "token"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS "position"
  FROM "AccountPushToken"
)
DELETE FROM "AccountPushToken"
WHERE "id" IN (
  SELECT "id"
  FROM "ranked_tokens"
  WHERE "position" > 1
);

DROP INDEX "AccountPushToken_accountId_token_key";

CREATE UNIQUE INDEX "AccountPushToken_token_key"
ON "AccountPushToken"("token");

CREATE INDEX "AccountPushToken_accountId_idx"
ON "AccountPushToken"("accountId");

COMMIT;
