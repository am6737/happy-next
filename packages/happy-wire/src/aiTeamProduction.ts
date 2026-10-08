import { z } from 'zod';

const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const version = z.number().int().positive();
const revision = version;
const date = z.string().datetime();
const mutationId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: id.nullable() });

// Frozen execution content and the current published template are independent.
// A rollback may put currentVersion below frozenVersion.
export const AiAgentTemplateContentSchema = z.object({
    role: z.string().trim().max(200), description: z.string().trim().min(1).max(4000),
    emoji: z.string().max(32), skills: z.array(z.string().max(200)).max(64),
    responsibilities: z.array(z.string().max(500)).max(64), instructions: z.string().max(65536),
}).strict();
export const AiExecutionTemplateContextSchema = z.object({
    templateId: id, sourceAgentId: id, sourceExecutionId: id,
    frozenVersion: version, frozenContentHash: hash, frozenContent: AiAgentTemplateContentSchema,
    currentVersion: version, currentContentHash: hash, currentContent: AiAgentTemplateContentSchema,
}).strict();
export const AiAgentTemplateProposalInputSchema = z.object({
    clientRequestId: mutationId, sourceAgentId: id.optional(), expectedCurrentVersion: z.number().int().nonnegative(),
    content: AiAgentTemplateContentSchema, note: z.string().trim().min(1).max(4000),
}).strict();
export const AiExecutionTemplateProposalInputSchema = z.object({
    machineId: id, dispatchToken: z.string().min(1), capability: hash, templateId: id,
    clientRequestId: mutationId, expectedCurrentVersion: version,
    content: AiAgentTemplateContentSchema, note: z.string().trim().min(1).max(4000),
}).strict();
export const AiAgentTemplateProposalSchema = z.object({
    id, actorAccountId: id, sourceAgentId: id.nullable(), sourceExecutionId: id.nullable(),
    expectedCurrentVersion: z.number().int().nonnegative(), contentHash: hash, content: AiAgentTemplateContentSchema,
    frozenVersion: version.nullable().optional(), frozenContentHash: hash.nullable().optional(),
    frozenContent: AiAgentTemplateContentSchema.nullable().optional(),
    note: z.string().nullable(), status: z.enum(['pending', 'accepted', 'rejected']),
    reviewedByAccountId: id.nullable(), reviewedAt: date.nullable(), publishedVersion: version.nullable(), createdAt: date,
});
export const AiAgentTemplateReviewInputSchema = z.object({
    decision: z.enum(['accepted', 'rejected']), confirmed: z.literal(true),
    expectedCurrentVersion: z.number().int().nonnegative(),
}).strict();
export const AiAgentTemplateReviewResultSchema = z.object({
    status: z.enum(['accepted', 'rejected']), publishedVersion: version.nullable(), duplicate: z.boolean(),
});

export const AiWorkItemPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const labels = z.array(z.string().trim().min(1).max(40)).max(20);
export const AiWorkItemMetadataPatchSchema = z.object({
    expectedRevision: revision, priority: AiWorkItemPrioritySchema.optional(),
    labels: labels.optional(), dueDate: date.nullable().optional(),
}).strict().refine(body => body.priority !== undefined || body.labels !== undefined || body.dueDate !== undefined);
export const AiWorkItemMetadataSchema = z.object({
    id, priority: AiWorkItemPrioritySchema, labels, dueDate: date.nullable(),
    metadataRevision: revision, updatedAt: date, subscribed: z.boolean(),
});
export const AiWorkItemMetadataResultSchema = z.object({
    priority: AiWorkItemPrioritySchema, labels, dueDate: date.nullable(), metadataRevision: revision, duplicate: z.boolean(),
});
export const AiWorkItemCommentInputSchema = z.object({ clientRequestId: mutationId,
    body: z.string().trim().min(1).max(16384) }).strict();
export const AiWorkItemCommentSchema = z.object({ id, actorAccountId: id, body: z.string(), createdAt: date });
export const AiWorkItemCommentsSchema = page(AiWorkItemCommentSchema);
export const AiWorkItemCommentResultSchema = AiWorkItemCommentSchema.extend({ duplicate: z.boolean() });
export const AiWorkItemSubscriptionResultSchema = z.object({ subscribed: z.boolean(), duplicate: z.boolean() });
// Safe notification projection excludes comment text and runtime credentials.
export const AiWorkItemNotificationSchema = z.object({ id, workItemId: id,
    action: z.enum(['comment_added', 'metadata_updated']), actorAccountId: id,
    createdAt: date, readAt: date.nullable() }).strict();
export const AiWorkItemNotificationsSchema = page(AiWorkItemNotificationSchema);
export const AiWorkItemNotificationReadResultSchema = z.object({ id, read: z.literal(true) });
export const AiArchivedAgentSchema = z.object({ id, name: z.string(), role: z.string(),
    archivedAt: date, enabled: z.boolean() });
export const AiArchivedAgentsSchema = page(AiArchivedAgentSchema);

const grantFields = { resourceKind: z.enum(['project', 'agent']), resourceId: id,
    canView: z.boolean(), canRun: z.boolean(), canApprove: z.boolean() };
const requireView = (body: { canView: boolean; canRun: boolean; canApprove: boolean }) =>
    body.canView || (!body.canRun && !body.canApprove);
export const AiWorkspaceGrantSchema = z.object(grantFields).strict().refine(requireView,
    { message: 'Run and approve require view', path: ['canView'] });
export const AiWorkspaceGrantInputSchema = z.object({ ...grantFields, memberAccountId: id,
    expectedAuthRevision: revision.optional() }).strict().refine(requireView,
    { message: 'Run and approve require view', path: ['canView'] });
export const AiWorkspaceGrantSnapshotSchema = z.object({ memberAccountId: id,
    role: z.enum(['owner', 'admin', 'member']), authRevision: revision, grants: z.array(AiWorkspaceGrantSchema) });

// These are server projections; they never grant mutation authority locally.
export type AiAgentTemplateContent = z.infer<typeof AiAgentTemplateContentSchema>;
export type AiExecutionTemplateContext = z.infer<typeof AiExecutionTemplateContextSchema>;
export type AiAgentTemplateProposal = z.infer<typeof AiAgentTemplateProposalSchema>;
export type AiAgentTemplateReviewInput = z.infer<typeof AiAgentTemplateReviewInputSchema>;
export type AiWorkItemMetadata = z.infer<typeof AiWorkItemMetadataSchema>;
export type AiWorkItemMetadataPatch = z.infer<typeof AiWorkItemMetadataPatchSchema>;
export type AiWorkItemComment = z.infer<typeof AiWorkItemCommentSchema>;
export type AiWorkItemNotification = z.infer<typeof AiWorkItemNotificationSchema>;
export type AiWorkspaceGrantSnapshot = z.infer<typeof AiWorkspaceGrantSnapshotSchema>;

export const AiWorkspaceWorkItemSchema = z.object({
    id, title: z.string(), summary: z.string(), projectId: id.nullable(), projectVersion: version.nullable(),
    assigneeId: id, teamId: id.nullable(), orchestratorRunId: id, orchestratorTaskId: id,
    // Older scoped responses omitted this field; never invent an attempt ID.
    orchestratorExecutionId: id.nullable().optional(), taskStatus: z.string().nullable(),
    latestExecutionStatus: z.string().nullable(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).nullable().optional(), workspaceAuthRevision: revision,
    availableActions: z.array(z.enum(['cancel', 'retry', 'steering', 'approve', 'changes_requested'])),
    priority: AiWorkItemPrioritySchema, labels, dueDate: date.nullable(), metadataRevision: revision,
    runStatus: z.string(), acceptanceStatus: z.string(), deliveryVerificationStatus: z.string(), createdAt: date, updatedAt: date,
});
export const AiCapabilityRecoverySchema = z.object({ id, executionId: id, machineId: id,
    status: z.enum(['pending', 'confirmed']), generation: version, requestExpiresAt: date,
    confirmedAt: date.nullable(), createdAt: date });
export const AiCapabilityRecoveryAuditSchema = z.object({ id, generation: version,
    audit: z.array(z.object({ generation: version, action: z.enum(['requested', 'confirmed', 'claimed', 'human_verified']),
        actorAccountId: id, createdAt: date })) });
export type AiWorkspaceWorkItem = z.infer<typeof AiWorkspaceWorkItemSchema>;
export type AiCapabilityRecovery = z.infer<typeof AiCapabilityRecoverySchema>;

const encoded = z.string().min(1).max(131072);
export const AiHumanRegistrationResponseSchema = z.object({
    id: z.string().min(1).max(4096), rawId: z.string().min(1).max(4096), type: z.literal('public-key'),
    response: z.object({ clientDataJSON: encoded, attestationObject: encoded }).passthrough(),
}).passthrough();
export const AiHumanAuthenticationResponseSchema = z.object({
    id: z.string().min(1).max(4096), rawId: z.string().min(1).max(4096), type: z.literal('public-key'),
    response: z.object({ clientDataJSON: encoded, authenticatorData: encoded, signature: encoded }).passthrough(),
}).passthrough();
export const AiHumanCredentialRegistrationInputSchema = z.object({ challengeId: id,
    response: AiHumanRegistrationResponseSchema }).strict();
export const AiHumanRecoveryConfirmInputSchema = z.object({
    confirmation: z.literal('drain_failed_execution'), generation: version, challengeId: id,
    assertion: AiHumanAuthenticationResponseSchema,
}).strict();
export const AiHumanCredentialSchema = z.object({ id, status: z.enum(['pending', 'trusted', 'revoked']),
    deviceType: z.enum(['singleDevice', 'multiDevice']), backedUp: z.boolean(), createdAt: date,
    trustedAt: date.nullable(), revokedAt: date.nullable(), lastUsedAt: date.nullable() });
export const AiExecutionCapabilityOperationSchema = z.enum(['identity', 'finish', 'skill_download',
    'delegate', 'event', 'usage', 'decision_request', 'template_propose']);
export const AiExecutionCapabilitySchema = z.object({ token: hash, protocolVersion: z.literal(1),
    allowedOps: z.array(AiExecutionCapabilityOperationSchema).max(16), expiresAt: date,
    recoveryMode: z.literal('drain').optional(), generation: version.optional(),
}).strict().superRefine((capability, context) => {
    if (capability.generation !== undefined && capability.recoveryMode !== 'drain') {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['generation'], message: 'Generation belongs to drain recovery' });
    }
    if (new Set(capability.allowedOps).size !== capability.allowedOps.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowedOps'], message: 'Capability operations must be distinct' });
    }
    if (capability.recoveryMode === 'drain'
        && [...capability.allowedOps].sort().join(',') !== 'event,finish,usage') {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowedOps'], message: 'Drain operations must be event, finish and usage' });
    }
});
export type AiHumanAuthenticationResponse = z.infer<typeof AiHumanAuthenticationResponseSchema>;
export type AiHumanCredential = z.infer<typeof AiHumanCredentialSchema>;
export type AiHumanRecoveryConfirmInput = z.infer<typeof AiHumanRecoveryConfirmInputSchema>;
export type AiExecutionCapability = z.infer<typeof AiExecutionCapabilitySchema>;
