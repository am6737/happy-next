import { Fastify } from "../types";
import { chatImageUpload } from "@/app/chat/chatImageUpload";
import { db } from "@/storage/db";
import { AttachmentQuotaError, AttachmentSizeError, chatAttachmentUpload, MAX_ATTACHMENT_CIPHERTEXT_BYTES } from '@/app/chat/chatAttachmentUpload';
import { canSendMessages, canViewSession } from '@/app/share/accessControl';
import { s3client, s3privateBucket } from '@/storage/files';
import { z } from 'zod';

export function chatRoutes(app: Fastify) {
    app.post('/v1/chat/sessions/:sessionId/upload-attachment', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ sessionId: z.string() }),
            querystring: z.object({
                size: z.coerce.number().int().min(16).max(MAX_ATTACHMENT_CIPHERTEXT_BYTES),
            }),
        },
    }, async (request, reply) => {
        const { sessionId } = request.params;
        if (!await canSendMessages(request.userId, sessionId)) return reply.status(404).send({ error: 'Session not found' });
        const part = await request.file({
            limits: { fileSize: MAX_ATTACHMENT_CIPHERTEXT_BYTES },
        });
        if (!part || part.fieldname !== 'file') return reply.status(400).send({ error: 'file is required' });

        let attachment;
        try {
            attachment = await chatAttachmentUpload({
                accountId: request.userId,
                sessionId,
                stream: part.file,
                size: request.query.size,
            });
        } catch (error) {
            if (error instanceof AttachmentQuotaError) {
                return reply.status(413).send({ error: error.message });
            }
            if (error instanceof AttachmentSizeError) {
                return reply.status(400).send({ error: error.message });
            }
            throw error;
        }
        return reply.send({ success: true, data: attachment });
    });

    app.get('/v1/chat/attachments/:attachmentId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ attachmentId: z.string() }) },
    }, async (request, reply) => {
        const attachment = await db.chatAttachment.findUnique({ where: { id: request.params.attachmentId } });
        if (!attachment || !await canViewSession(request.userId, attachment.sessionId)) {
            return reply.status(404).send({ error: 'Attachment not found' });
        }
        return reply.send({
            v: attachment.encryptionVersion,
            id: attachment.id,
            ciphertextSize: attachment.size,
        });
    });

    app.get('/v1/chat/attachments/:attachmentId/download', {
        preHandler: app.authenticate,
        schema: { params: z.object({ attachmentId: z.string() }) },
    }, async (request, reply) => {
        const attachment = await db.chatAttachment.findUnique({ where: { id: request.params.attachmentId } });
        if (!attachment || !await canViewSession(request.userId, attachment.sessionId)) {
            return reply.status(404).send({ error: 'Attachment not found' });
        }
        const stream = await s3client.getObject(s3privateBucket, attachment.path);
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Length', String(attachment.size));
        reply.header('Content-Disposition', 'attachment; filename="attachment.bin"');
        reply.header('Cache-Control', 'private, max-age=300');
        return reply.send(stream);
    });

    /**
     * Upload an image for a chat session.
     *
     * Expects multipart/form-data with:
     * - file: The image file (required)
     * - sessionId: The chat session ID (required)
     *
     * Returns the uploaded image URL and metadata including dimensions and thumbhash.
     */
    app.post("/v1/chat/upload-image", {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        // Parse multipart data using parts() iterator
        let fileBuffer: Buffer | null = null;
        let fileMimeType: string | null = null;
        let sessionId: string | null = null;

        for await (const part of request.parts()) {
            if (part.type === 'file') {
                if (part.fieldname === 'file') {
                    fileBuffer = await part.toBuffer();
                    fileMimeType = part.mimetype;
                }
            } else {
                if (part.fieldname === 'sessionId') {
                    sessionId = part.value as string;
                }
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: "No file uploaded" });
        }

        if (!sessionId) {
            return reply.status(400).send({ error: "sessionId is required" });
        }

        // Verify session belongs to user
        const session = await db.session.findFirst({
            where: {
                id: sessionId,
                accountId: userId,
            },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        // Validate mime type
        const mimeType = fileMimeType || "image/jpeg";
        if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
            return reply.status(400).send({ error: "Only JPEG and PNG images are supported" });
        }

        // Upload image
        const result = await chatImageUpload(userId, sessionId, fileBuffer, mimeType);

        return reply.send({
            success: true,
            data: result,
        });
    });
}
