import { db } from "@/storage/db";
import { OtaUpdateTarget } from "./otaUpdatePublish";

/**
 * Sends apps on this channel, platform and runtime version back to the JS built into their
 * binary, until a newer update is published. The publisher picks the id, so a retry changes
 * nothing.
 */
export async function otaUpdateRollBackToEmbedded(input: OtaUpdateTarget & { id: string; message: string | null }) {
    await db.otaUpdate.upsert({
        where: { id: input.id },
        create: {
            id: input.id,
            channel: input.channel,
            platform: input.platform,
            runtimeVersion: input.runtimeVersion,
            kind: 'rollBackToEmbedded',
            message: input.message,
        },
        update: {},
    });
}
