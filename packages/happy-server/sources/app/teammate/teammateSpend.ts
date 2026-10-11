import { db } from '@/storage/db';
import type { TeammateSpend } from 'happy-wire';

/** Sum UsageReport.data.cost.total for this teammate's sessions since the current UTC month began. */
export async function teammateSpendGet(accountId: string, teammateId: string, now: Date = new Date()): Promise<TeammateSpend | null> {
    const teammate = await db.teammate.findFirst({
        where: { id: teammateId, accountId },
        select: { monthlyBudgetUsd: true },
    });
    if (!teammate) return null;
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sessions = await db.teammateSession.findMany({
        where: { teammateId, teammate: { accountId } },
        select: { sessionId: true },
    });
    const reports = sessions.length === 0 ? [] : await db.usageReport.findMany({
        where: { accountId, sessionId: { in: sessions.map((s) => s.sessionId) }, createdAt: { gte: monthStart } },
        select: { data: true },
    });
    const spentUsd = reports.reduce((sum, report) => {
        const cost = report.data?.cost?.total;
        return sum + (typeof cost === 'number' && Number.isFinite(cost) ? cost : 0);
    }, 0);
    return { teammateId, monthStart: monthStart.getTime(), spentUsd, budgetUsd: teammate.monthlyBudgetUsd };
}
