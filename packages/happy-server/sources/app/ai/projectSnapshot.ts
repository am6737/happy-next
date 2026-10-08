import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { integrationExpectedHash } from './integrationHash';

export type DispatchProjectSnapshot = {
    projectId: string; version: number; kind?: 'local' | 'github';
    repositoryId: string | null; repositoryFullName: string | null;
    commonGitDirHash?: string | null; machineId: string; registeredRepoId: string;
    registeredKvVersion: number; workingDirectory: string; defaultBranch: string;
    baseCommit: string; snapshotHash: string;
};

export class ProjectSnapshotInvalidError extends Error {
    constructor(readonly reason: 'incomplete' | 'task_identity' | 'repository_identity' | 'hash') {
        super(`Frozen project identity is invalid: ${reason}`);
    }
}

export async function loadDispatchProjectSnapshot(tx: Prisma.TransactionClient, input: {
    runId: string; accountId: string; metadata: unknown;
    taskMachineId: string | null; taskDirectory: string | null;
    taskBaseCommit: string | null; dispatchMachineId: string;
}): Promise<DispatchProjectSnapshot | undefined> {
    const work = await tx.aiWorkItem.findFirst({ where: { accountId: input.accountId,
        orchestratorRunId: input.runId }, select: { projectId: true, projectVersion: true } });
    const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? input.metadata as Record<string, unknown> : {};
    const metadataId = metadata.aiProjectId;
    if (!work?.projectId && !metadataId) return undefined;
    if (!work?.projectId || !work.projectVersion || metadataId !== work.projectId
        || metadata.aiProjectVersion !== work.projectVersion) throw new ProjectSnapshotInvalidError('incomplete');
    const version = await tx.aiProjectVersion.findUnique({ where: { projectId_version: {
        projectId: work.projectId, version: work.projectVersion,
    } }, include: { project: { select: { accountId: true } } } });
    if (!version || version.project.accountId !== input.accountId
        || input.taskMachineId !== version.machineId || input.dispatchMachineId !== version.machineId
        || input.taskDirectory !== version.workingDirectory
        || input.taskBaseCommit !== version.baseCommit
        || metadata.aiProjectMachineId !== version.machineId
        || metadata.aiProjectBaseCommit !== version.baseCommit) {
        throw new ProjectSnapshotInvalidError('task_identity');
    }
    const canonical = { repositoryId: version.repositoryId?.toString() ?? null,
        repositoryFullName: version.repositoryFullName,
        machineId: version.machineId, registeredRepoId: version.registeredRepoId,
        registeredKvVersion: version.registeredKvVersion,
        workingDirectory: version.workingDirectory, defaultBranch: version.defaultBranch,
        baseCommit: version.baseCommit };
    const local = version.kind === 'local';
    if (local && (canonical.repositoryId !== null || canonical.repositoryFullName !== null
        || !/^[0-9a-f]{64}$/i.test(version.commonGitDirHash ?? ''))) {
        throw new ProjectSnapshotInvalidError('repository_identity');
    }
    if (!local && (!canonical.repositoryId || !canonical.repositoryFullName)) {
        throw new ProjectSnapshotInvalidError('repository_identity');
    }
    const current = local ? { kind: 'local', ...canonical,
        commonGitDirHash: version.commonGitDirHash } : { kind: 'github', ...canonical };
    const currentHash = local ? integrationExpectedHash(current)
        : createHash('sha256').update(JSON.stringify(current)).digest('hex');
    const legacyHash = !local ? createHash('sha256').update(JSON.stringify(canonical)).digest('hex') : null;
    if (version.snapshotHash !== currentHash && version.snapshotHash !== legacyHash) {
        throw new ProjectSnapshotInvalidError('hash');
    }
    return { projectId: version.projectId, version: version.version,
        ...(version.snapshotHash === legacyHash ? {} : { kind: version.kind as 'local' | 'github' }),
        ...canonical, ...(local ? { commonGitDirHash: version.commonGitDirHash } : {}),
        snapshotHash: version.snapshotHash };
}
