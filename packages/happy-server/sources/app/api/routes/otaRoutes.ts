import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { Fastify } from "../types";
import { getPublicUrl } from "@/storage/files";
import {
    OTA_CHANNEL_REGEX,
    OTA_HASH_REGEX,
    OTA_PLATFORMS,
    buildOtaManifest,
    buildOtaMultipart,
    buildRollBackToEmbeddedDirective,
    otaAssetPath,
} from "@/app/ota/otaManifest";
import { otaAssetUpload } from "@/app/ota/otaAssetUpload";
import { otaAssetsMissing } from "@/app/ota/otaAssetsMissing";
import { otaUpdatePublish } from "@/app/ota/otaUpdatePublish";
import { otaUpdateRepublish } from "@/app/ota/otaUpdateRepublish";
import { otaUpdateRollBackToEmbedded } from "@/app/ota/otaUpdateRollBackToEmbedded";
import { otaUpdateLatest } from "@/app/ota/otaUpdateLatest";
import { otaUpdateList } from "@/app/ota/otaUpdateList";

const hash = z.string().regex(OTA_HASH_REGEX);
const channel = z.string().regex(OTA_CHANNEL_REGEX);
const platform = z.enum(OTA_PLATFORMS);
const runtimeVersion = z.string().min(1).max(128);
const message = z.string().max(500).nullish().transform((v) => v ?? null);
const asset = z.object({
    hash,
    key: z.string().regex(/^[a-f0-9]{32}$/),
    fileExtension: z.string().max(32),
    contentType: z.string().max(128),
});

/**
 * The publisher's routes take OTA_ADMIN_TOKEN as a bearer token. Without it set on the server
 * they don't exist (404), so a server that doesn't host updates exposes nothing.
 */
function otaAdmin(request: FastifyRequest, reply: FastifyReply) {
    const token = process.env.OTA_ADMIN_TOKEN?.trim();
    if (!token) {
        reply.code(404).send({ error: 'Not found' });
        return false;
    }
    const given = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const a = new TextEncoder().encode(given);
    const b = new TextEncoder().encode(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        reply.code(401).send({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

/**
 * OTA updates for the app: the expo-updates manifest it polls, and the routes the publish
 * script (happy-app sources/scripts/ota.ts) uploads files and publishes through. Files live in
 * S3 under their hash and the app downloads them from S3_PUBLIC_URL.
 */
export function otaRoutes(app: Fastify) {

    // Uploaded files come as raw bytes
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
        done(null, body);
    });

    // The app's expo-updates asks here on launch and from useUpdates (app.config.js updates.url)
    app.get('/v1/ota/manifest', async (request, reply) => {
        const headers = request.headers;
        const parsed = z.object({
            'expo-platform': platform,
            'expo-runtime-version': runtimeVersion,
            'expo-channel-name': channel.default('production'),
        }).safeParse(headers);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Invalid expo-updates request' });
        }

        reply.header('expo-protocol-version', '1');
        reply.header('expo-sfv-version', '0');
        reply.header('cache-control', 'private, max-age=0');

        const latest = await otaUpdateLatest({
            channel: parsed.data['expo-channel-name'],
            platform: parsed.data['expo-platform'],
            runtimeVersion: parsed.data['expo-runtime-version'],
        });

        // Nothing published, or the app already runs it: a 204 means no update
        if (!latest || latest.id === headers['expo-current-update-id']) {
            return reply.code(204).send();
        }

        const multipart = latest.kind === 'update' && latest.content
            ? buildOtaMultipart([{
                name: 'manifest',
                json: buildOtaManifest({ ...latest, content: latest.content }, (h) => getPublicUrl(otaAssetPath(h))),
            }])
            : buildOtaMultipart([{ name: 'directive', json: buildRollBackToEmbeddedDirective(latest.createdAt) }]);
        return reply.code(200).type(multipart.contentType).send(multipart.body);
    });

    app.post('/v1/ota/assets/missing', {
        schema: {
            body: z.object({ hashes: z.array(hash).max(10000) }),
        },
    }, async (request, reply) => {
        if (!otaAdmin(request, reply)) return;
        return { missing: await otaAssetsMissing(request.body.hashes) };
    });

    app.put('/v1/ota/assets/:hash', {
        schema: {
            params: z.object({ hash }),
            querystring: z.object({ contentType: z.string().min(1).max(128) }),
        },
    }, async (request, reply) => {
        if (!otaAdmin(request, reply)) return;
        if (!(request.body instanceof Uint8Array)) {
            return reply.code(415).send({ error: 'Send the file as application/octet-stream' });
        }
        const ok = await otaAssetUpload(request.params.hash, request.query.contentType, request.body);
        if (!ok) {
            return reply.code(400).send({ error: 'File does not match its hash' });
        }
        return { success: true };
    });

    app.get('/v1/ota/updates', {
        schema: {
            querystring: z.object({
                channel: channel.optional(),
                platform: platform.optional(),
                limit: z.coerce.number().int().min(1).max(200).default(20),
            }),
        },
    }, async (request, reply) => {
        if (!otaAdmin(request, reply)) return;
        const { limit, ...filter } = request.query;
        return { updates: await otaUpdateList(filter, limit) };
    });

    app.post('/v1/ota/updates', {
        schema: {
            body: z.object({
                id: z.string().uuid(),
                channel,
                platform,
                runtimeVersion,
                message,
                gitCommit: z.string().max(64).nullish().transform((v) => v ?? null),
                launchAsset: asset,
                assets: z.array(asset).max(10000),
                expoClient: z.record(z.string(), z.unknown()),
            }),
        },
    }, async (request, reply) => {
        if (!otaAdmin(request, reply)) return;
        const { launchAsset, assets, expoClient, ...rest } = request.body;
        const { missing } = await otaUpdatePublish({ ...rest, content: { launchAsset, assets, expoClient } });
        if (missing.length > 0) {
            return reply.code(409).send({ error: 'Files not uploaded', missing });
        }
        return { success: true };
    });

    app.post('/v1/ota/updates/:id/republish', {
        schema: {
            params: z.object({ id: z.string().uuid() }),
            body: z.object({ newId: z.string().uuid(), message }),
        },
    }, async (request, reply) => {
        if (!otaAdmin(request, reply)) return;
        const ok = await otaUpdateRepublish(request.params.id, request.body.newId, request.body.message);
        if (!ok) {
            return reply.code(404).send({ error: 'Update not found' });
        }
        return { success: true };
    });

    app.post('/v1/ota/rollback-to-embedded', {
        schema: {
            body: z.object({ id: z.string().uuid(), channel, platform, runtimeVersion, message }),
        },
    }, async (request, reply) => {
        if (!otaAdmin(request, reply)) return;
        await otaUpdateRollBackToEmbedded(request.body);
        return { success: true };
    });
}
