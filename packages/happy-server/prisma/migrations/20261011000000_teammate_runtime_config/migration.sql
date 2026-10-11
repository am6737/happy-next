-- Controller and worker runtimes are configured independently.
ALTER TABLE "Teammate" ADD COLUMN "controllerProvider" TEXT NOT NULL DEFAULT 'claude',
ADD COLUMN "controllerModel" TEXT,
ADD COLUMN "controllerPermissionMode" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN "controllerProfileId" TEXT,
ADD COLUMN "controllerEnv" TEXT,
ADD COLUMN "workerProfileId" TEXT,
ADD COLUMN "workerEnv" TEXT;

-- Controllers previously ran on Claude with the worker permission mode mapped to its Claude equivalent.
UPDATE "Teammate" SET "controllerPermissionMode" = CASE
    WHEN "workerPermissionMode" IN ('default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions') THEN "workerPermissionMode"
    WHEN "workerPermissionMode" IN ('full-auto', 'yolo') THEN 'bypassPermissions'
    WHEN "workerPermissionMode" IN ('on-failure', 'auto_edit') THEN 'acceptEdits'
    ELSE 'default'
END;
