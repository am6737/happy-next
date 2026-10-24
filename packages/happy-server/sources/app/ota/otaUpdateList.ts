import { db } from "@/storage/db";

/** The newest updates and rollbacks, newest first, without their file lists */
export async function otaUpdateList(filter: { channel?: string; platform?: string }, limit: number) {
    const rows = await db.otaUpdate.findMany({
        where: filter,
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
    return rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        platform: row.platform,
        runtimeVersion: row.runtimeVersion,
        kind: row.kind,
        message: row.message,
        gitCommit: row.gitCommit,
        republishedFrom: row.republishedFrom,
        assetCount: row.content ? row.content.assets.length + 1 : 0,
        createdAt: row.createdAt.getTime(),
    }));
}
