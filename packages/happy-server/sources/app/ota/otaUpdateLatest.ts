import { db } from "@/storage/db";
import { OtaUpdateTarget } from "./otaUpdatePublish";

/** The newest update or rollback for this channel, platform and runtime version: what the manifest serves */
export async function otaUpdateLatest(target: OtaUpdateTarget) {
    return db.otaUpdate.findFirst({
        where: target,
        orderBy: { createdAt: 'desc' },
    });
}
