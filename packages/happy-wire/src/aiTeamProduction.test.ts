import { describe, expect, it } from 'vitest';
import { AiAgentTemplateContentSchema, AiExecutionTemplateContextSchema,
    AiWorkspaceGrantInputSchema, AiExecutionCapabilitySchema,
    AiHumanRecoveryConfirmInputSchema, AiWorkItemNotificationSchema } from './aiTeamProduction';

const content = { role: 'Reviewer', description: 'Review changes', emoji: '', skills: [],
    responsibilities: [], instructions: 'Review the actual changes' };
const hash = 'a'.repeat(64);

describe('AI production protocol authority boundaries', () => {
    it('permits rollback independently of the execution frozen version', () => {
        const context = { templateId: 'template', sourceAgentId: 'agent', sourceExecutionId: 'execution',
            frozenVersion: 2, frozenContentHash: hash, frozenContent: content,
            currentVersion: 1, currentContentHash: hash, currentContent: content };
        expect(AiExecutionTemplateContextSchema.safeParse(context).success).toBe(true);
        expect(AiExecutionTemplateContextSchema.safeParse({ ...context, capability: hash }).success).toBe(false);
    });
    it('rejects runtime or permission fields in template content', () => {
        for (const field of ['engine', 'model', 'workingDirectory', 'permissionMode', 'allowDelegation', 'enabled']) {
            expect(AiAgentTemplateContentSchema.safeParse({ ...content, [field]: 'override' }).success).toBe(false);
        }
    });
    it('requires view for execution and approval grants without allowing role injection', () => {
        const grant = { memberAccountId: 'member', resourceKind: 'agent', resourceId: 'agent',
            canView: false, canRun: true, canApprove: false, expectedAuthRevision: 1 };
        expect(AiWorkspaceGrantInputSchema.safeParse(grant).success).toBe(false);
        expect(AiWorkspaceGrantInputSchema.safeParse({ ...grant, canView: true }).success).toBe(true);
        expect(AiWorkspaceGrantInputSchema.safeParse({ ...grant, canView: true, role: 'owner' }).success).toBe(false);
    });
    it('keeps drain scope separate from template or tool authority', () => {
        const drain = { token: hash, protocolVersion: 1, allowedOps: ['event', 'finish', 'usage'],
            expiresAt: '2026-10-07T20:00:00.000Z', recoveryMode: 'drain', generation: 2 };
        expect(AiExecutionCapabilitySchema.safeParse(drain).success).toBe(true);
        expect(AiExecutionCapabilitySchema.safeParse({ ...drain, allowedOps: [...drain.allowedOps, 'template_propose'] }).success).toBe(false);
        expect(AiExecutionCapabilitySchema.safeParse({ ...drain, allowedOps: ['finish', 'event', 'event'] }).success).toBe(false);
        expect(AiExecutionCapabilitySchema.safeParse({ ...drain, recoveryMode: undefined }).success).toBe(false);
    });
    it('rejects legacy JWT-only confirmation and binds the new assertion envelope', () => {
        const legacy = { confirmation: 'drain_failed_execution', generation: 1 };
        expect(AiHumanRecoveryConfirmInputSchema.safeParse(legacy).success).toBe(false);
        const confirmed = { ...legacy, challengeId: 'challenge', assertion: { id: 'credential',
            rawId: 'credential', type: 'public-key', response: {
                clientDataJSON: 'encoded', authenticatorData: 'encoded', signature: 'encoded' } } };
        expect(AiHumanRecoveryConfirmInputSchema.safeParse(confirmed).success).toBe(true);
        expect(AiHumanRecoveryConfirmInputSchema.safeParse({ ...confirmed, confirmation: 'restart_execution' }).success).toBe(false);
        expect(AiHumanRecoveryConfirmInputSchema.safeParse({ ...confirmed, capability: hash }).success).toBe(false);
    });
    it('keeps notification projections free of comment content or credentials', () => {
        const notification = { id: 'notification', workItemId: 'work', action: 'comment_added',
            actorAccountId: 'actor', createdAt: '2026-10-07T20:00:00.000Z', readAt: null };
        expect(AiWorkItemNotificationSchema.safeParse(notification).success).toBe(true);
        expect(AiWorkItemNotificationSchema.safeParse({ ...notification, body: 'private comment' }).success).toBe(false);
        expect(AiWorkItemNotificationSchema.safeParse({ ...notification, token: hash }).success).toBe(false);
    });
});
