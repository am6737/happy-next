import { db } from "@/storage/db";

/**
 * Rolls back to an earlier update by publishing a copy of it under a new id. A copy is needed
 * because the app only switches to an update newer than the one it runs. The publisher picks
 * the new id, so a retry changes nothing. Returns false when the source isn't a served update.
 */
export async function otaUpdateRepublish(sourceId: string, newId: string, message: string | null) {
    const source = await db.otaUpdate.findUnique({ where: { id: sourceId } });
    if (!source || source.kind !== 'update' || !source.content) {
        return false;
    }
    await db.otaUpdate.upsert({
        where: { id: newId },
        create: {
            id: newId,
            channel: source.channel,
            platform: source.platform,
            runtimeVersion: source.runtimeVersion,
            kind: 'update',
            content: source.content,
            message: message ?? source.message,
            gitCommit: source.gitCommit,
            republishedFrom: source.id,
        },
        update: {},
    });
    return true;
}
