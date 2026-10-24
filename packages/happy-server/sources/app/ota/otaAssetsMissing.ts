import { db } from "@/storage/db";

/** The hashes among these that have no stored file yet, which the publisher then uploads */
export async function otaAssetsMissing(hashes: string[]) {
    const found = await db.otaAsset.findMany({
        where: { hash: { in: hashes } },
        select: { hash: true },
    });
    const foundSet = new Set(found.map((a) => a.hash));
    return [...new Set(hashes)].filter((h) => !foundSet.has(h));
}
