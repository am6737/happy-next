import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { listConnectedUserRpcMethods } from '@/app/api/socket/rpcRegistry';
import { claimInbound, failInbound } from '@/app/api/routes/aiInboundRequest';
import { resolveGithubChatSource, submitWork } from '@/app/api/routes/aiTeamRoutes';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import { warn } from '@/utils/log';

const LEASE_MS = 60_000;

export async function planAutopilotCronTick(now = new Date(), accountId?: string): Promise<void> {
    const rules = await db.aiAutopilot.findMany({ where: { enabled: true, triggerKind: 'cron',
        ...(accountId ? { accountId } : {}) }, orderBy: { id: 'asc' }, take: 100 });
    for (const rule of rules) {
        if (!rule.cronExpression || !rule.timezone || !rule.lastPlannedAt) continue;
        try {
            const iterator = CronExpressionParser.parse(rule.cronExpression, {
                currentDate: rule.lastPlannedAt, tz: rule.timezone,
            });
            const planned: Date[] = [];
            for (let i = 0; i < rule.catchupLimit; i++) {
                const next = iterator.next().toDate();
                if (next > now) break;
                planned.push(next);
            }
            if (!planned.length) continue;
            await db.$transaction(async (tx) => {
                const claimed = await tx.aiAutopilot.updateMany({ where: { id: rule.id,
                    accountId: rule.accountId, enabled: true, lastPlannedAt: rule.lastPlannedAt },
                    data: { lastPlannedAt: planned.length >= rule.catchupLimit ? now : planned.at(-1)! } });
                if (!claimed.count) return;
                await tx.aiAutopilotRun.createMany({ data: planned.map((plannedAt) => ({
                    autopilotId: rule.id, triggerKey: `cron:${plannedAt.toISOString()}`, plannedAt,
                })), skipDuplicates: true });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
                warn({ module: 'ai-autopilot', ruleId: rule.id }, 'Cron planning failed');
            }
        }
    }
}

export async function autopilotRunTick(now = new Date(), accountId?: string): Promise<void> {
    const submitted = await db.aiAutopilotRun.findMany({ where: { status: 'submitted',
        orchestratorRunId: { not: null }, ...(accountId ? { autopilot: { accountId } } : {}) },
        select: { id: true, orchestratorRunId: true }, take: 100 });
    for (const item of submitted) {
        const run = await db.orchestratorRun.findUnique({ where: { id: item.orchestratorRunId! },
            select: { status: true } });
        if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
            await db.aiAutopilotRun.updateMany({ where: { id: item.id, status: 'submitted' },
                data: { status: run.status } });
        }
    }
    const rows = await db.aiAutopilotRun.findMany({ where: {
        ...(accountId ? { autopilot: { accountId } } : {}),
        OR: [{ status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'processing', leaseUntil: { lt: now } }],
    }, orderBy: { plannedAt: 'asc' }, take: 20,
    include: { autopilot: true } });
    await Promise.all(rows.map(async (row) => {
        const rule = row.autopilot;
        if (!rule.enabled) return;
        const project = await db.aiProject.findFirst({ where: { id: rule.projectId,
            accountId: rule.accountId, active: true }, include: {
            versions: { orderBy: { version: 'desc' }, take: 1 },
        } });
        const snapshot = project?.versions[0];
        if (!snapshot) return;
        if (snapshot.kind === 'local' && rule.action !== 'run_only') {
            await db.aiAutopilotRun.updateMany({ where: { id: row.id, status: row.status },
                data: { status: 'failed', errorCode: 'local_project_cannot_create_issue' } });
            return;
        }
        const [machine, grant] = await Promise.all([
            db.machine.findFirst({ where: { id: snapshot.machineId,
                accountId: rule.accountId, active: true }, select: { id: true } }),
            snapshot.kind === 'local' || !snapshot.repositoryId ? Promise.resolve(null)
                : db.aiGithubRepositoryGrant.findUnique({ where: { accountId_repositoryId: {
                    accountId: rule.accountId, repositoryId: snapshot.repositoryId,
                } }, select: { fullName: true } }),
        ]);
        if (!machine || (snapshot.kind !== 'local'
            && (!grant || grant.fullName !== snapshot.repositoryFullName))) {
            await db.aiAutopilotRun.updateMany({ where: { id: row.id, status: row.status,
                ...(row.status === 'processing' ? { leaseUntil: { lt: now } } : {}),
            }, data: { status: 'failed', errorCode: 'project_authorization_changed',
                claimOwner: null, leaseUntil: null } });
            return;
        }
        if (!listConnectedUserRpcMethods(rule.accountId)
            .includes(`${snapshot.machineId}:orchestrator-dispatch`)) return;
        const owner = randomUUID();
        // The rule lock serializes distinct trigger keys across instances. A
        // processing row reserves capacity before its submission side effect.
        const reservation = await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${rule.id}))::text`;
            const currentRule = await tx.aiAutopilot.findUnique({ where: { id: rule.id },
                select: { enabled: true, concurrencyPolicy: true } });
            if (!currentRule?.enabled) return 'unavailable' as const;
            const older = await tx.aiAutopilotRun.count({ where: { autopilotId: rule.id,
                status: 'pending', plannedAt: { lt: row.plannedAt } } });
            if (older) return 'waiting' as const;
            const others = await tx.aiAutopilotRun.findMany({ where: { autopilotId: rule.id,
                id: { not: row.id }, status: { in: ['processing', 'submitted'] } },
                select: { status: true, leaseUntil: true, orchestratorRunId: true } });
            const processing = others.some((item) => item.status === 'processing'
                && item.leaseUntil && item.leaseUntil > now);
            const submittedIds = others.map((item) => item.orchestratorRunId).filter((id): id is string => !!id);
            const running = submittedIds.length ? await tx.orchestratorRun.findMany({ where: {
                id: { in: submittedIds }, accountId: rule.accountId,
                status: { in: ['queued', 'running', 'canceling'] },
            }, select: { id: true } }) : [];
            if (processing || running.length) {
                if (currentRule.concurrencyPolicy === 'skip') {
                    const skipped = await tx.aiAutopilotRun.updateMany({ where: { id: row.id,
                        status: row.status,
                        ...(row.status === 'processing' ? { leaseUntil: { lt: now } }
                            : { nextAttemptAt: { lte: now } }),
                    }, data: { status: 'skipped', claimOwner: null, leaseUntil: null,
                        errorCode: 'concurrent_run' } });
                    return skipped.count ? 'skipped' as const : 'unavailable' as const;
                }
                if (currentRule.concurrencyPolicy === 'replace' && running.length) {
                    await tx.orchestratorRun.updateMany({ where: { id: { in: running.map((item) => item.id) },
                        accountId: rule.accountId, status: { in: ['queued', 'running'] } },
                        data: { status: 'canceling', cancelRequestedAt: now } });
                    await tx.orchestratorTask.updateMany({ where: { runId: { in: running.map((item) => item.id) },
                        status: 'queued' }, data: { status: 'cancelled', errorCode: 'AUTOPILOT_REPLACED' } });
                }
                return 'waiting' as const;
            }
            const claimed = await tx.aiAutopilotRun.updateMany({ where: { id: row.id,
                status: row.status,
                ...(row.status === 'processing' ? { leaseUntil: { lt: now } }
                    : { nextAttemptAt: { lte: now } }),
            }, data: { status: 'processing', claimOwner: owner,
                leaseUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } } });
            return claimed.count ? 'claimed' as const : 'unavailable' as const;
        }).catch((error) => {
            warn({ module: 'ai-autopilot', ruleId: rule.id,
                error: error instanceof Error ? error.message : 'unknown' }, 'Capacity reservation failed');
            return 'unavailable' as const;
        });
        if (reservation !== 'claimed') return;
        let leaseOwned = true;
        const renew = async () => {
            const changed = await db.aiAutopilotRun.updateMany({ where: { id: row.id,
                claimOwner: owner, status: 'processing', leaseUntil: { gt: new Date() } },
            data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
            if (changed.count !== 1) leaseOwned = false;
        };
        const timer = setInterval(() => { void renew().catch(() => { leaseOwned = false; }); }, LEASE_MS / 3);
        timer.unref();
        const assertOwner = async () => {
            if (!leaseOwned || !await db.aiAutopilotRun.count({ where: { id: row.id,
                claimOwner: owner, status: 'processing', leaseUntil: { gt: new Date() } } })) {
                throw new Error('Autopilot lease owner changed');
            }
        };
        try {
            await assertOwner();
            const idempotencyKey = `ai:${rule.conversationId}:${row.id}`;
            const existing = await db.orchestratorRun.findFirst({ where: { accountId: rule.accountId,
                idempotencyKey }, include: { aiWorkItem: true } });
            let result: { runId: string; workItemId: string } | null = existing?.aiWorkItem
                ? { runId: existing.id, workItemId: existing.aiWorkItem.id } : null;
            let issueResourceId: string | null = existing?.aiWorkItem?.sourceType === 'github'
                ? existing.aiWorkItem.sourceResourceId : null;
            if (!result) {
                const claim = await claimInbound({ accountId: rule.accountId,
                    conversationId: rule.conversationId, clientMessageId: row.id },
                { action: 'autopilot', autopilotId: rule.id, runId: row.id });
                if (claim.kind === 'conflict') throw new Error('Autopilot inbound identity conflict');
                if (claim.kind === 'processing') throw new Error('Autopilot inbound claim is processing');
                if (claim.kind === 'completed') {
                    const response = claim.response as { runId?: string; workItemId?: string } | null;
                    if (!response?.runId || !response.workItemId) throw new Error('Autopilot response is incomplete');
                    result = { runId: response.runId, workItemId: response.workItemId };
                } else {
                    try {
                        await assertOwner();
                        const source = rule.action === 'create_issue' && snapshot.repositoryFullName
                            ? await resolveGithubChatSource(rule.accountId,
                                `https://github.com/${snapshot.repositoryFullName}\n${rule.prompt}`, claim.claim) : null;
                        if (rule.action === 'create_issue' && !source) throw new Error('Issue creation failed');
                        issueResourceId = source?.sourceResourceId ?? null;
                        await assertOwner();
                        const created = await submitWork(rule.accountId, {
                            agentId: rule.agentId, teamId: rule.teamId ?? undefined,
                            conversationId: rule.conversationId, clientMessageId: row.id,
                            title: `${rule.name}: ${row.plannedAt.toISOString()}`.slice(0, 256),
                            summary: source ? `${rule.prompt}\n\n${source.deliveryInstruction}` : rule.prompt,
                            sourceType: source?.sourceType ?? 'execution',
                            sourceLabel: source?.sourceLabel ?? 'Autopilot',
                            sourceResourceId: source?.sourceResourceId ?? row.id,
                        }, claim.claim, undefined, { ...snapshot, projectId: project!.id,
                            version: project!.currentVersion, runOnly: rule.action === 'run_only' },
                        { autopilotRunId: row.id, autopilotId: rule.id, owner });
                        result = { runId: created.runId, workItemId: created.workItemId };
                    } catch (error) { await failInbound(claim.claim); throw error; }
                }
            }
            const completed = await db.aiAutopilotRun.updateMany({ where: { id: row.id, claimOwner: owner,
                status: 'processing', leaseUntil: { gt: new Date() } }, data: { status: 'submitted', claimOwner: null,
                leaseUntil: null, orchestratorRunId: result.runId,
                workItemId: result.workItemId, issueResourceId } });
            if (completed.count !== 1) throw new Error('Autopilot lease owner changed');
        } catch (error) {
            const attempts = row.attempts + 1;
            const uncertain = error instanceof Error && error.message.includes('uncertain');
            await db.aiAutopilotRun.updateMany({ where: { id: row.id, claimOwner: owner,
                status: 'processing' }, data: { status: attempts >= 12 && !uncertain ? 'failed' : 'pending',
                claimOwner: null, leaseUntil: null,
                nextAttemptAt: new Date(now.getTime() + Math.min(5_000 * 2 ** attempts, 600_000)),
                errorCode: uncertain ? 'issue_uncertain' : 'submission_failed' } });
        } finally {
            clearInterval(timer);
        }
    }));
}

export function startAutopilotWorker(): void {
    forever('ai-autopilot', async () => {
        try { await planAutopilotCronTick(); await autopilotRunTick(); }
        catch { warn({ module: 'ai-autopilot' }, 'Autopilot tick failed'); }
        await delay(15_000, shutdownSignal);
    });
}
