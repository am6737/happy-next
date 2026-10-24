import { createHash } from "crypto";
import * as privacyKit from "privacy-kit";
import { db } from "@/storage/db";
import { s3bucket, s3client } from "@/storage/files";
import { otaAssetPath } from "./otaManifest";

/** Base64url SHA-256, unpadded, as the expo-updates manifest gives a file's hash */
export function otaAssetHash(data: Uint8Array) {
    return privacyKit.encodeBase64(createHash('sha256').update(data).digest(), 'base64url').replace(/=+$/, '');
}

/**
 * Stores one file of an OTA update in S3 under its hash and records it, so later updates that
 * have the same file skip the upload. Returns false when the data doesn't match the hash.
 * Idempotent: the same hash is always the same bytes, so a retry rewrites the same object.
 */
export async function otaAssetUpload(hash: string, contentType: string, data: Uint8Array) {
    if (otaAssetHash(data) !== hash) {
        return false;
    }
    await s3client.putObject(s3bucket, otaAssetPath(hash), data as Buffer, data.length, {
        'Content-Type': contentType,
        // A hash names exactly one file, so it never changes
        'Cache-Control': 'public, max-age=31536000, immutable',
    });
    await db.otaAsset.upsert({
        where: { hash },
        create: { hash, contentType, size: data.length },
        update: {},
    });
    return true;
}
