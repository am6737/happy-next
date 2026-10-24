import { randomUUID } from "crypto";

// The expo-updates protocol (v1), as the app's expo-updates reads it:
// https://docs.expo.dev/technical-specs/expo-updates-1/

export const OTA_PLATFORMS = ['ios', 'android'] as const;
export type OtaPlatform = typeof OTA_PLATFORMS[number];

/** Base64url SHA-256, unpadded: what the manifest's `hash` holds and the app checks downloads against */
export const OTA_HASH_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const OTA_CHANNEL_REGEX = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function otaAssetPath(hash: string) {
    return `ota/assets/${hash}`;
}

export type OtaUpdateRow = {
    id: string;
    runtimeVersion: string;
    createdAt: Date;
    content: PrismaJson.OtaUpdateContent;
};

export function buildOtaManifest(update: OtaUpdateRow, assetUrl: (hash: string) => string) {
    const asset = (a: PrismaJson.OtaUpdateAsset) => ({
        hash: a.hash,
        key: a.key,
        fileExtension: a.fileExtension,
        contentType: a.contentType,
        url: assetUrl(a.hash),
    });
    return {
        id: update.id,
        createdAt: update.createdAt.toISOString(),
        runtimeVersion: update.runtimeVersion,
        launchAsset: asset(update.content.launchAsset),
        assets: update.content.assets.map(asset),
        metadata: {},
        extra: { expoClient: update.content.expoClient },
    };
}

/** The directive that makes the app drop its OTA updates and run the JS in its binary */
export function buildRollBackToEmbeddedDirective(createdAt: Date) {
    return { type: 'rollBackToEmbedded', parameters: { commitTime: createdAt.toISOString() } };
}

/** A multipart/mixed body of JSON parts, named as the protocol wants ("manifest", "directive") */
export function buildOtaMultipart(parts: { name: string; json: unknown }[]) {
    const boundary = 'ota-' + randomUUID();
    let body = '';
    for (const part of parts) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="${part.name}"\r\n`;
        body += `Content-Type: application/json; charset=utf-8\r\n\r\n`;
        body += JSON.stringify(part.json) + '\r\n';
    }
    body += `--${boundary}--\r\n`;
    return { contentType: `multipart/mixed; boundary=${boundary}`, body };
}
