ALTER TABLE "AiProjectVersion" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'github';
ALTER TABLE "AiProjectVersion" ADD COLUMN "commonGitDirHash" TEXT;
ALTER TABLE "AiProjectVersion" ALTER COLUMN "repositoryId" DROP NOT NULL;
ALTER TABLE "AiProjectVersion" ALTER COLUMN "repositoryFullName" DROP NOT NULL;
