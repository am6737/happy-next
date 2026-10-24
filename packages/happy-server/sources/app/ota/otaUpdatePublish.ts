import { db } from "@/storage/db";
import { otaAssetsMissing } from "./otaAssetsMissing";

export type OtaUpdateTarget = {
    channel: string;
    platform: string;
    runtimeVersion: string;
};

/**
 * Publishes an OTA update: from now on it's what the manifest serves to apps on its channel,
 * platform and runtime version. Every file must already be uploaded; otherwise nothing is
 * published and the missing hashes are returned. The publisher picks the id, so a retried
 * publish finds its update already there and changes nothing.
 */
export async function otaUpdatePublish(input: OtaUpdateTarget & {
    id: string;
    message: string | null;
    gitCommit: string | null;
    content: PrismaJson.OtaUpdateContent;
}): Promise<{ missing: string[] }> {
    const hashes = [input.content.launchAsset.hash, ...input.content.assets.map((a) => a.hash)];
    const missing = await otaAssetsMissing(hashes);
    if (missing.length > 0) {
        return { missing };
    }
    await db.otaUpdate.upsert({
        where: { id: input.id },
        create: {
            id: input.id,
            channel: input.channel,
            platform: input.platform,
            runtimeVersion: input.runtimeVersion,
            kind: 'update',
            content: input.content,
            message: input.message,
            gitCommit: input.gitCommit,
        },
        update: {},
    });
    return { missing: [] };
}
