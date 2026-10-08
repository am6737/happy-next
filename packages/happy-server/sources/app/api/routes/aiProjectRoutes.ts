import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/storage/db';
import { integrationExpectedHash } from '@/app/ai/integrationHash';
import { getUserOctokit } from '@/app/github/githubApi';
import { hasUserRpcMethod, invokeUserRpc } from '../socket/rpcRegistry';
import { RpcBridgeUnavailableError } from '../socket/rpcBridge';
import type { Fastify } from '../types';

const bindingSchema = z.object({
    kind: z.literal('github').optional(),
    repositoryId: z.string().regex(/^[1-9]\d{0,19}$/),
    machineId: z.string().min(1).max(200),
    registeredRepoId: z.string().min(1).max(200),
    registeredKvVersion: z.number().int().nonnegative(),
    workingDirectory: z.string().min(1).max(512).refine((value) => value.startsWith('/')
        && !/[\r\n\0]/.test(value) && !value.split('/').includes('..')),
    defaultBranch: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/)
        .refine((value) => !value.startsWith('-') && !value.includes('..') && !value.endsWith('/')),
}).strict();

const localBindingSchema = bindingSchema.omit({ repositoryId: true }).extend({
    kind: z.literal('local'),
});
const createFields = { name: z.string().trim().min(1).max(200),
    clientRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) };
const updateFields = { expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(200).optional(), active: z.boolean().optional() };

function parseRemote(remote: string): string | null {
    const match = remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    return match?.[1].toLowerCase() ?? null;
}

type DefaultBranchLookup = (accountId: string, fullName: string) => Promise<{
    repositoryId: bigint; defaultBranch: string; canPush: boolean }>;

async function githubDefaultBranch(accountId: string, fullName: string) {
    const [owner, repo] = fullName.split('/');
    const octokit = await getUserOctokit(accountId);
    const { data } = await octokit.rest.repos.get({ owner, repo,
        request: { signal: AbortSignal.timeout(15_000) } });
    return { repositoryId: BigInt(data.id), defaultBranch: data.default_branch,
        canPush: Boolean(data.permissions?.push) };
}

async function verifiedBinding(accountId: string, input: z.infer<typeof bindingSchema>,
    lookup: DefaultBranchLookup) {
    const [machine, grant, kv] = await Promise.all([
        db.machine.findFirst({ where: { id: input.machineId, accountId, active: true }, select: { id: true } }),
        db.aiGithubRepositoryGrant.findUnique({ where: { accountId_repositoryId: {
            accountId, repositoryId: BigInt(input.repositoryId),
        } }, select: { fullName: true } }),
        db.userKVStore.findUnique({ where: { accountId_key: {
            accountId, key: `repos:${input.machineId}`,
        } }, select: { version: true, value: true } }),
    ]);
    if (!machine || !grant || !kv?.value || kv.version !== input.registeredKvVersion) {
        throw new Error('Machine, repository grant or registered repo version is unavailable');
    }
    const github = await lookup(accountId, grant.fullName);
    if (github.repositoryId !== BigInt(input.repositoryId) || !github.canPush
        || github.defaultBranch !== input.defaultBranch) {
        throw new Error('GitHub default branch or repository authorization changed');
    }
    const method = `${machine.id}:bash`;
    if (!hasUserRpcMethod(accountId, method)) throw new Error('Machine is offline');
    const path = `'${input.workingDirectory.replace(/'/g, "'\\''")}'`;
    const command = `git -C ${path} remote get-url origin && git -C ${path} rev-parse refs/remotes/origin/${input.defaultBranch}`;
    const response = await invokeUserRpc(accountId, method, { command, cwd: '/', timeout: 10_000 }, 12_000) as {
        success?: boolean; stdout?: string;
    };
    const [remote, baseCommit] = response?.stdout?.trim().split(/\r?\n/) ?? [];
    if (!response?.success || parseRemote(remote ?? '') !== grant.fullName.toLowerCase()
        || !/^[0-9a-f]{40}$/i.test(baseCommit ?? '')) {
        throw new Error('Machine Git identity does not match the repository grant');
    }
    const snapshot = { kind: 'github', repositoryId: BigInt(input.repositoryId), repositoryFullName: grant.fullName,
        machineId: machine.id, registeredRepoId: input.registeredRepoId,
        registeredKvVersion: kv.version, workingDirectory: input.workingDirectory,
        defaultBranch: input.defaultBranch, baseCommit };
    const snapshotHash = createHash('sha256').update(JSON.stringify({ ...snapshot,
        repositoryId: input.repositoryId })).digest('hex');
    return { ...snapshot, snapshotHash };
}

async function verifiedLocalBinding(accountId: string, input: z.infer<typeof localBindingSchema>) {
    const [machine, kv] = await Promise.all([
        db.machine.findFirst({ where: { id: input.machineId, accountId, active: true }, select: { id: true } }),
        db.userKVStore.findUnique({ where: { accountId_key: {
            accountId, key: `repos:${input.machineId}`,
        } }, select: { version: true, value: true } }),
    ]);
    if (!machine || !kv?.value || kv.version !== input.registeredKvVersion) {
        throw new Error('Machine or registered repo version is unavailable');
    }
    const method = `${machine.id}:orchestrator-verify-registered-repo`;
    if (!hasUserRpcMethod(accountId, method)) throw new Error('Registered repo verifier is unavailable');
    const verified = await invokeUserRpc(accountId, method, {
        registeredRepoId: input.registeredRepoId, workingDirectory: input.workingDirectory,
        defaultBranch: input.defaultBranch,
    }, 12_000) as { verified?: boolean; registeredRepoId?: string; workingDirectory?: string;
        commonGitDirHash?: string; baseCommit?: string };
    if (!verified?.verified || verified.registeredRepoId !== input.registeredRepoId
        || verified.workingDirectory !== input.workingDirectory
        || !/^[0-9a-f]{64}$/i.test(verified.commonGitDirHash ?? '')
        || !/^[0-9a-f]{40}$/i.test(verified.baseCommit ?? '')) {
        throw new Error('Registered local Git identity did not verify');
    }
    const snapshot = { kind: 'local', repositoryId: null, repositoryFullName: null,
        commonGitDirHash: verified.commonGitDirHash!, machineId: machine.id,
        registeredRepoId: input.registeredRepoId, registeredKvVersion: kv.version,
        workingDirectory: verified.workingDirectory!, defaultBranch: input.defaultBranch,
        baseCommit: verified.baseCommit! };
    const snapshotHash = integrationExpectedHash(snapshot);
    return { ...snapshot, snapshotHash };
}

function publicProject(row: { id: string; name: string; active: boolean; currentVersion: number;
    versions: Array<{ kind: string; repositoryId: bigint | null; repositoryFullName: string | null;
        commonGitDirHash: string | null; machineId: string;
        registeredRepoId: string; registeredKvVersion: number; defaultBranch: string;
        baseCommit: string; snapshotHash: string }> }) {
    const snapshot = row.versions[0];
    return { id: row.id, name: row.name, active: row.active, version: row.currentVersion,
        snapshot: snapshot ? { kind: snapshot.kind,
            repositoryId: snapshot.repositoryId?.toString() ?? null,
            repository: snapshot.repositoryFullName, commonGitDirHash: snapshot.commonGitDirHash,
            machineId: snapshot.machineId,
            registeredRepoId: snapshot.registeredRepoId, registeredKvVersion: snapshot.registeredKvVersion,
            defaultBranch: snapshot.defaultBranch, baseCommit: snapshot.baseCommit,
            snapshotHash: snapshot.snapshotHash } : null };
}

export function aiProjectRoutes(app: Fastify, lookup: DefaultBranchLookup = githubDefaultBranch) {
    app.get('/v1/ai-team/projects', { preHandler: app.authenticate }, async (request, reply) => {
        const rows = await db.aiProject.findMany({ where: { accountId: request.userId },
            orderBy: { updatedAt: 'desc' }, take: 100,
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        return reply.send({ items: rows.map(publicProject) });
    });
    app.get('/v1/ai-team/projects/:id', { preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) } }, async (request, reply) => {
        const row = await db.aiProject.findFirst({ where: { id: request.params.id,
            accountId: request.userId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        if (!row) return reply.code(404).send({ error: 'Project not found' });
        return reply.send(publicProject(row));
    });
    app.post('/v1/ai-team/projects', { preHandler: app.authenticate,
        schema: { body: z.union([bindingSchema.extend(createFields),
            localBindingSchema.extend(createFields)]) } }, async (request, reply) => {
        const input = request.body;
        const createPayloadHash = integrationExpectedHash(input);
        const existing = await db.aiProject.findUnique({ where: { accountId_clientRequestId: {
            accountId: request.userId, clientRequestId: input.clientRequestId,
        } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        if (existing) {
            if (existing.createPayloadHash !== createPayloadHash) {
                return reply.code(409).send({ error: 'Project request id reused with different content' });
            }
            return reply.send(publicProject(existing));
        }
        try {
            const snapshot = input.kind === 'local'
                ? await verifiedLocalBinding(request.userId, input)
                : await verifiedBinding(request.userId, input, lookup);
            const row = await db.aiProject.create({ data: { accountId: request.userId,
                clientRequestId: input.clientRequestId, createPayloadHash, name: input.name,
                versions: { create: { version: 1, ...snapshot } },
            }, include: { versions: true } });
            return reply.code(201).send(publicProject(row));
        } catch (error) {
            if (error instanceof RpcBridgeUnavailableError) {
                return reply.header('Retry-After', '2').code(503).send({
                    errorCode: 'AI_RPC_BRIDGE_UNAVAILABLE',
                });
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return reply.code(409).send({ error: 'Project request is processing; retry' });
            }
            return reply.code(409).send({ error: error instanceof Error ? error.message : 'Project binding failed' });
        }
    });
    app.patch('/v1/ai-team/projects/:id', { preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }), body: z.union([
            bindingSchema.extend(updateFields), localBindingSchema.extend(updateFields),
        ]) } }, async (request, reply) => {
        try {
            const snapshot = request.body.kind === 'local'
                ? await verifiedLocalBinding(request.userId, request.body)
                : await verifiedBinding(request.userId, request.body, lookup);
            const updated = await db.$transaction(async (tx) => {
                const changed = await tx.aiProject.updateMany({ where: { id: request.params.id,
                    accountId: request.userId, currentVersion: request.body.expectedVersion },
                    data: { currentVersion: { increment: 1 },
                        ...(request.body.name ? { name: request.body.name } : {}),
                        ...(request.body.active !== undefined ? { active: request.body.active } : {}) } });
                if (!changed.count) return null;
                await tx.aiProjectVersion.create({ data: { projectId: request.params.id,
                    version: request.body.expectedVersion + 1, ...snapshot } });
                return tx.aiProject.findUnique({ where: { id: request.params.id },
                    include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            if (!updated) return reply.code(409).send({ error: 'Project version changed or is unavailable' });
            return reply.send(publicProject(updated));
        } catch (error) {
            if (error instanceof RpcBridgeUnavailableError) {
                return reply.header('Retry-After', '2').code(503).send({
                    errorCode: 'AI_RPC_BRIDGE_UNAVAILABLE',
                });
            }
            return reply.code(409).send({ error: error instanceof Error ? error.message : 'Project update failed' });
        }
    });
}
