import type { AuthCredentials } from '@/auth/tokenStorage';
import { AiAgentTemplateProposalSchema, AiCapabilityRecoveryAuditSchema, AiCapabilityRecoverySchema,
    AiCollaborationSchema, AiHumanCredentialSchema, AiMessageResponseSchema, AiSteeringStatusSchema,
    AiTeamDataSchema, AiWorkspaceWorkItemSchema } from 'happy-wire';
import type { AiAgent, AiAgentSettings, AiTeam, AiTeamData, AiMessageOptions, AiMessageResponse, AiCollaboration, AiSteeringStatus } from 'happy-wire';
import { z } from 'zod';
import { getServerUrl } from './serverConfig';

type AgentInput = Pick<AiAgent, 'name' | 'role' | 'description' | 'emoji' | 'skills' | 'responsibilities'> & {
    settings: AiAgentSettings;
    enabled: boolean;
};

type TeamInput = Pick<AiTeam, 'name' | 'description' | 'emoji' | 'leaderId' | 'memberIds' | 'instructions' | 'currentGoal'>;
export type GeneratedAgentDraft = Pick<AiAgent, 'name' | 'role' | 'description' | 'emoji' | 'skills' | 'responsibilities'> & { settings: AiAgentSettings };
export type { AiMessageOptions, AiMessageResponse, AiCollaboration, AiSteeringStatus } from 'happy-wire';

const pendingClarificationSchema = z.object({ items: z.array(z.object({
    id: z.string(), clientMessageId: z.string(), originalText: z.string(), question: z.string(),
    candidates: z.array(z.object({ id: z.string(), name: z.string() })).nullable(),
    targetWorkItemId: z.string().nullable(), createdAt: z.string(),
})) });
export type AiPendingClarification = z.infer<typeof pendingClarificationSchema>['items'][number];
export type AiSkillSummary = { id: string; name: string; teamId: string | null; currentVersion: number | null; updatedAt: string };
export type AiSkillFile = { path: string; contentBase64: string };
export type AiSkillDetail = Pick<AiSkillSummary, 'id' | 'name' | 'teamId' | 'currentVersion'> & {
    versions: Array<{ version: number; contentHash: string; publishedAt: string | null; createdAt: string }>;
    bindings: Array<{ agentId: string }>;
};
export type AiSkillVersion = { skillId: string; version: number; hash: string; publishedAt: string | null; isCurrent: boolean;
    files: Array<AiSkillFile & { sha256: string; size: number }> };
export type AiSkillProposal = { id: string; text: string; status: 'pending' | 'accepted' | 'rejected'; createdAt: string; reviewedAt: string | null };
export type AiWorkspace = { id: string; name: string; role: 'owner' | 'admin' | 'member'; ownerAccountId: string };
export type AiWorkspaceMember = { memberAccountId: string; role: 'owner' | 'admin' | 'member'; createdAt: string };
export type AiWorkspaceGrantSnapshot = { memberAccountId: string; role: 'owner' | 'admin' | 'member'; authRevision: number;
    grants: Array<{ resourceKind: 'project' | 'agent'; resourceId: string; canView: boolean; canRun: boolean; canApprove: boolean }> };
export type AiWorkspaceResource = { id: string; name: string; active?: boolean; enabled?: boolean; currentVersion?: number; role?: string };
export type AiWorkspaceWorkItem = z.infer<typeof AiWorkspaceWorkItemSchema>;
export type AiArchivedAgent = { id: string; name: string; role: string; archivedAt: string; enabled: boolean };
export type AiCapabilityRecovery = z.infer<typeof AiCapabilityRecoverySchema>;
export type AiCapabilityRecoveryAudit = z.infer<typeof AiCapabilityRecoveryAuditSchema>['audit'][number];
export function fetchAiCapabilityRecoveries(credentials: AuthCredentials): Promise<{ items: AiCapabilityRecovery[] }> {
    return request<unknown>(credentials, '/v1/ai-team/capability-recoveries?limit=50')
        .then((value) => z.object({ items: z.array(AiCapabilityRecoverySchema) }).parse(value));
}
export function fetchAiCapabilityRecoveryAudit(credentials: AuthCredentials, id: string): Promise<{
    id: string; generation: number; audit: AiCapabilityRecoveryAudit[];
}> {
    return request<unknown>(credentials, `/v1/ai-team/capability-recoveries/${encodeURIComponent(id)}/audit`)
        .then((value) => AiCapabilityRecoveryAuditSchema.parse(value));
}
export type AiHumanCredential = z.infer<typeof AiHumanCredentialSchema>;
export function fetchAiHumanCredentials(credentials: AuthCredentials): Promise<{ items: AiHumanCredential[] }> {
    return request<unknown>(credentials, '/v1/ai-team/human-credentials')
        .then((value) => z.object({ items: z.array(AiHumanCredentialSchema) }).parse(value));
}
export function beginAiHumanCredentialRegistration(credentials: AuthCredentials): Promise<{ challengeId: string; options: Record<string, unknown> }> {
    return request(credentials, '/v1/ai-team/human-credentials/registration/options', { method: 'POST' });
}
export function verifyAiHumanCredentialRegistration(credentials: AuthCredentials, challengeId: string, response: Record<string, unknown>): Promise<{ credentialId: string; status: 'pending' }> {
    return request(credentials, '/v1/ai-team/human-credentials/registration/verify', {
        method: 'POST', body: JSON.stringify({ challengeId, response }),
    });
}
export function revokeAiHumanCredential(credentials: AuthCredentials, id: string): Promise<unknown> {
    return request(credentials, `/v1/ai-team/human-credentials/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
}
export function beginAiCapabilityRecoveryConfirmation(credentials: AuthCredentials, id: string, generation: number): Promise<{
    challengeId: string; options: Record<string, unknown>; recoveryId: string; generation: number; action: 'drain_failed_execution' }> {
    return request(credentials, `/v1/ai-team/capability-recoveries/${encodeURIComponent(id)}/confirmation/options`, {
        method: 'POST', body: JSON.stringify({ generation }),
    });
}
export function confirmAiCapabilityRecovery(credentials: AuthCredentials, id: string, generation: number,
    challengeId: string, assertion: Record<string, unknown>): Promise<unknown> {
    return request(credentials, `/v1/ai-team/capability-recoveries/${encodeURIComponent(id)}/confirm`, {
        method: 'POST', body: JSON.stringify({ confirmation: 'drain_failed_execution', generation, challengeId, assertion }),
    });
}
export type AiAgentTemplateContent = z.infer<typeof import('happy-wire').AiAgentTemplateContentSchema>;
export type AiAgentTemplateSummary = { id: string; name: string; currentVersion: number | null;
    versions: Array<{ version: number; contentHash: string; publishedAt: string | null }> };
export type AiAgentTemplateDetail = AiAgentTemplateSummary & { versions: Array<{
    version: number; contentHash: string; publishedAt: string | null; createdAt: string }> };
export type AiAgentTemplateVersion = { version: number; contentHash: string; content: AiAgentTemplateContent;
    publishedAt: string | null; current: boolean; createdAt: string };
export type AiAgentTemplateProposal = z.infer<typeof AiAgentTemplateProposalSchema>;
export function fetchAiAgentTemplateProposals(credentials: AuthCredentials, id: string): Promise<{ items: AiAgentTemplateProposal[] }> {
    return request<unknown>(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}/proposals`)
        .then((value) => z.object({ items: z.array(AiAgentTemplateProposalSchema) }).parse(value));
}
export function reviewAiAgentTemplateProposal(credentials: AuthCredentials, id: string, proposalId: string,
    decision: 'accepted' | 'rejected', expectedCurrentVersion: number): Promise<{ status: string; publishedVersion: number | null }> {
    return request(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}/review`, {
        method: 'POST', body: JSON.stringify({ decision, confirmed: true, expectedCurrentVersion }),
    });
}

export function fetchAiAgentTemplates(credentials: AuthCredentials): Promise<{ items: AiAgentTemplateSummary[] }> {
    return request(credentials, '/v1/ai-team/agent-templates');
}
export function createAiAgentTemplate(credentials: AuthCredentials, name: string, content: AiAgentTemplateContent): Promise<{
    id: string; version: number; contentHash: string; status: 'draft';
}> {
    return request(credentials, '/v1/ai-team/agent-templates', { method: 'POST', body: JSON.stringify({ name, content }) });
}
export function fetchAiAgentTemplate(credentials: AuthCredentials, id: string): Promise<AiAgentTemplateDetail> {
    return request(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}`);
}
export function fetchAiAgentTemplateVersion(credentials: AuthCredentials, id: string, version: number): Promise<AiAgentTemplateVersion> {
    return request(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}/versions/${version}`);
}
export function createAiAgentTemplateVersion(credentials: AuthCredentials, id: string, content: AiAgentTemplateContent): Promise<{
    version: number; contentHash: string; status: 'draft';
}> {
    return request(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}/versions`, {
        method: 'POST', body: JSON.stringify({ content }),
    });
}
export function publishAiAgentTemplate(credentials: AuthCredentials, id: string, version: number): Promise<{ currentVersion: number }> {
    return request(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}/versions/${version}/publish`, {
        method: 'POST', body: JSON.stringify({ confirmed: true }),
    });
}
export function rollbackAiAgentTemplate(credentials: AuthCredentials, id: string, version: number): Promise<{ currentVersion: number }> {
    return request(credentials, `/v1/ai-team/agent-templates/${encodeURIComponent(id)}/rollback`, {
        method: 'POST', body: JSON.stringify({ version, confirmed: true }),
    });
}
export function applyAiAgentTemplate(credentials: AuthCredentials, agentId: string, templateId: string, expectedVersion: number): Promise<{
    version: number; contentHash: string;
}> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(agentId)}/apply-template`, {
        method: 'POST', body: JSON.stringify({ templateId, expectedVersion, confirmed: true }),
    });
}
export function fetchAiAgentTemplateSource(credentials: AuthCredentials, agentId: string): Promise<{
    source: null | { templateId: string; templateName: string; version: number; contentHash: string; current: boolean };
}> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(agentId)}/template-source`);
}
export type AiDecisionRequest = { id: string; workspaceId: string; workItemId: string; executionId: string;
    kind: 'approval' | 'review'; payload: { summary?: string }; status: 'pending' | 'decided' | 'expired';
    operationId: string | null; actionType: string | null; actionHash: string | null;
    version: number; expiresAt: string; decision: 'approved' | 'rejected' | null;
    decidedAt: string | null; deliveryStatus: string; errorCode: string | null; createdAt: string };
export type AiPersistentExecutionEvent = { eventId: string; seq: number; kind: 'status' | 'tool' | 'result' | 'comment'; phase: string;
    occurredAt: string; redactedSummary: string; redactedAt: string | null };
export type AiWorkMetadata = { id: string; priority: 'low' | 'normal' | 'high' | 'urgent'; labels: string[];
    dueDate: string | null; metadataRevision: number; subscribed: boolean; updatedAt: string };
export type AiWorkComment = { id: string; actorAccountId: string; body: string; createdAt: string };
export type AiWorkAudit = { id: string; actorAccountId: string; action: string;
    before: unknown; after: unknown; createdAt: string };
export type AiWorkNotification = { id: string; workItemId: string; action: string;
    actorAccountId: string; createdAt: string; readAt: string | null };
export function fetchAiWorkNotifications(credentials: AuthCredentials, cursor?: string): Promise<{
    items: AiWorkNotification[]; nextCursor: string | null;
}> {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    return request(credentials, `/v1/ai-team/notifications?${params}`);
}
export function markAiWorkNotificationRead(credentials: AuthCredentials, id: string): Promise<{ id: string; read: true }> {
    return request(credentials, `/v1/ai-team/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function fetchAiWorkMetadata(credentials: AuthCredentials, workItemId: string): Promise<AiWorkMetadata> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/metadata`);
}
export function patchAiWorkMetadata(credentials: AuthCredentials, workItemId: string, input: {
    expectedRevision: number; priority?: AiWorkMetadata['priority']; labels?: string[]; dueDate?: string | null;
}): Promise<AiWorkMetadata & { duplicate: boolean }> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/metadata`, {
        method: 'PATCH', body: JSON.stringify(input),
    });
}
export function fetchAiWorkComments(credentials: AuthCredentials, workItemId: string, cursor?: string): Promise<{
    items: AiWorkComment[]; nextCursor: string | null;
}> {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/comments?${params}`);
}
export function postAiWorkComment(credentials: AuthCredentials, workItemId: string, input: {
    clientRequestId: string; body: string;
}): Promise<AiWorkComment & { duplicate: boolean }> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/comments`, {
        method: 'POST', body: JSON.stringify(input),
    });
}
export function setAiWorkSubscription(credentials: AuthCredentials, workItemId: string, subscribed: boolean): Promise<{
    subscribed: boolean; duplicate: boolean;
}> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/subscription`, {
        method: subscribed ? 'PUT' : 'DELETE',
    });
}
export function fetchAiWorkAudit(credentials: AuthCredentials, workItemId: string, cursor?: string): Promise<{
    items: AiWorkAudit[]; nextCursor: string | null;
}> {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/audit?${params}`);
}

export function fetchAiExecutionEvents(credentials: AuthCredentials, executionId: string, afterSeq = 0): Promise<{
    items: AiPersistentExecutionEvent[]; nextAfterSeq: number;
}> {
    return request(credentials, `/v1/ai-team/executions/${encodeURIComponent(executionId)}/events?afterSeq=${afterSeq}&limit=50`);
}

export function fetchAiDecisions(credentials: AuthCredentials, status: 'pending' | 'decided' | 'expired', cursor?: string): Promise<{
    items: AiDecisionRequest[]; nextCursor: string | null;
}> {
    const params = new URLSearchParams({ status, limit: '50' });
    if (cursor) params.set('cursor', cursor);
    return request(credentials, `/v1/ai-team/decisions?${params}`);
}

export function respondAiDecision(credentials: AuthCredentials, id: string, input: {
    version: number; clientRequestId: string; decision: 'approved' | 'rejected'; note: string;
}): Promise<{ id: string; status: string; version: number; deliveryStatus: string }> {
    return request(credentials, `/v1/ai-team/decisions/${encodeURIComponent(id)}/respond`, {
        method: 'POST', body: JSON.stringify(input),
    });
}

export function retryAiDecisionDelivery(credentials: AuthCredentials, id: string): Promise<{ status: 'pending' }> {
    return request(credentials, `/v1/ai-team/decisions/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function fetchAiWorkspaces(credentials: AuthCredentials): Promise<{ items: AiWorkspace[] }> {
    return request(credentials, '/v1/ai-team/workspaces');
}

export function fetchAiWorkspaceMembers(credentials: AuthCredentials, workspaceId: string): Promise<{ items: AiWorkspaceMember[]; authRevision: number }> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/members`);
}

export function fetchAiWorkspaceGrants(credentials: AuthCredentials, workspaceId: string, memberAccountId: string): Promise<AiWorkspaceGrantSnapshot> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/grants?memberAccountId=${encodeURIComponent(memberAccountId)}`);
}

export function fetchAiWorkspaceResources(credentials: AuthCredentials, workspaceId: string, kind: 'project' | 'agent'): Promise<{ items: AiWorkspaceResource[] }> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/resources?kind=${kind}`);
}

export function fetchAiWorkspaceWorkItems(credentials: AuthCredentials, workspaceId: string): Promise<{ items: AiWorkspaceWorkItem[] }> {
    return request<unknown>(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/work-items?limit=50`)
        .then((value) => z.object({ items: z.array(AiWorkspaceWorkItemSchema) }).parse(value));
}

export function fetchAiWorkspaceWorkItem(credentials: AuthCredentials, workspaceId: string, workItemId: string): Promise<AiWorkspaceWorkItem> {
    return request<unknown>(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/work-items/${encodeURIComponent(workItemId)}`)
        .then((value) => AiWorkspaceWorkItemSchema.parse(value));
}

export function runAiWorkspaceProject(credentials: AuthCredentials, workspaceId: string, projectId: string, input: {
    clientRequestId: string; agentId: string; title: string; summary: string;
}): Promise<{ workItemId: string; executionId: string; conversationId: string; runId: string }> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/run`, {
        method: 'POST', body: JSON.stringify(input),
    });
}

export function setAiWorkspaceMember(credentials: AuthCredentials, workspaceId: string, accountId: string, role: 'admin' | 'member'): Promise<{ role: string }> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(accountId)}`, {
        method: 'PUT', body: JSON.stringify({ role }),
    });
}

export function removeAiWorkspaceMember(credentials: AuthCredentials, workspaceId: string, accountId: string): Promise<void> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
}

export function setAiWorkspaceGrant(credentials: AuthCredentials, workspaceId: string, input: {
    memberAccountId: string; resourceKind: 'project' | 'agent'; resourceId: string;
    canView: boolean; canRun: boolean; canApprove: boolean; expectedAuthRevision: number;
}): Promise<{ ok: boolean }> {
    return request(credentials, `/v1/ai-team/workspaces/${encodeURIComponent(workspaceId)}/grants`, {
        method: 'PUT', body: JSON.stringify(input),
    });
}

function headers(credentials: AuthCredentials) {
    return { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' };
}

async function request<T>(credentials: AuthCredentials, path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    init?.signal?.addEventListener('abort', cancel, { once: true });
    if (init?.signal?.aborted) cancel();
    const timer = setTimeout(cancel, 60_000);
    try {
        const response = await fetch(`${getServerUrl()}${path}`, { ...init, signal: controller.signal, headers: { ...headers(credentials), ...init?.headers } });
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string; errorCode?: string };
            throw new AiTeamRequestError(response.status, body.error ?? body.errorCode ?? `AI team request failed: ${response.status}`);
        }
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
    } finally {
        clearTimeout(timer);
        init?.signal?.removeEventListener('abort', cancel);
    }
}

export class AiTeamRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'AiTeamRequestError';
    }
}

export function fetchAiTeamState(credentials: AuthCredentials): Promise<AiTeamData> {
    return request<unknown>(credentials, '/v1/ai-team/state').then((value) => AiTeamDataSchema.parse(value));
}

export function createAiAgent(credentials: AuthCredentials, input: AgentInput): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/agents', { method: 'POST', body: JSON.stringify(input) });
}

export function generateAiAgent(credentials: AuthCredentials, prompt: string): Promise<GeneratedAgentDraft> {
    return request(credentials, '/v1/ai-team/agents/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
}

export function updateAiAgent(credentials: AuthCredentials, id: string, input: AgentInput): Promise<void> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function duplicateAiAgent(credentials: AuthCredentials, id: string): Promise<{ id: string }> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
}

export function deleteAiAgent(credentials: AuthCredentials, id: string): Promise<void> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fetchAiArchivedAgents(credentials: AuthCredentials, cursor?: string): Promise<{ items: AiArchivedAgent[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    return request(credentials, `/v1/ai-team/agents/archived?${params}`);
}

export function restoreAiAgent(credentials: AuthCredentials, id: string): Promise<{ id: string; enabled: false; duplicate: boolean }> {
    return request(credentials, `/v1/ai-team/agents/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

export function createAiTeam(credentials: AuthCredentials, input: TeamInput): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/teams', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAiTeam(credentials: AuthCredentials, id: string, input: TeamInput): Promise<void> {
    return request(credentials, `/v1/ai-team/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteAiTeam(credentials: AuthCredentials, id: string): Promise<void> {
    return request(credentials, `/v1/ai-team/teams/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function ensureAiConversation(credentials: AuthCredentials, input: { agentId: string; teamId?: string | null }): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/conversations', { method: 'POST', body: JSON.stringify(input) });
}

export function createAiAssignment(credentials: AuthCredentials, input: {
    agentId: string;
    teamId?: string;
    conversationId?: string;
    title: string;
    summary: string;
    sourceType?: 'github' | 'dootask' | 'session' | 'execution';
    sourceLabel?: string;
    sourceResourceId?: string;
    clientMessageId: string;
}): Promise<{ workItemId: string; executionId: string; conversationId: string; runId: string }> {
    return request(credentials, '/v1/ai-team/assignments', { method: 'POST', body: JSON.stringify(input) });
}

export function sendAiConversationMessage(credentials: AuthCredentials, conversationId: string, text: string, clientMessageId: string, options: AiMessageOptions = {}): Promise<AiMessageResponse> {
    return request<unknown>(credentials, `/v1/ai-team/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ text, clientMessageId, ...options }) }).then((value) => AiMessageResponseSchema.parse(value));
}

export function updateAiWorkAcceptance(credentials: AuthCredentials, workItemId: string, status: 'approved' | 'changes_requested', note?: string, clientMessageId?: string, reviewedExecutionId?: string): Promise<void> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/acceptance`, {
        method: 'POST', body: JSON.stringify({ status, note, clientMessageId, reviewedExecutionId }),
    });
}

export function commandAiWorkItem(credentials: AuthCredentials, workItemId: string, command: 'cancel' | 'retry', clientRequestId: string): Promise<{ status: string; executionId?: string }> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/${command}`, {
        method: 'POST', body: JSON.stringify({ clientRequestId }),
    });
}

export function steerAiWorkItem(credentials: AuthCredentials, workItemId: string, input: {
    clientRequestId: string; targetTaskId: string; text: string;
}): Promise<{ steeringId: string; status: string }> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/steering`, {
        method: 'POST', body: JSON.stringify(input),
    });
}

export function fetchAiCollaboration(credentials: AuthCredentials, workItemId: string): Promise<AiCollaboration> {
    return request<unknown>(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/collaboration`).then((value) => AiCollaborationSchema.parse(value));
}

export type AiIntegrationVerification = { status: string; executionId?: string; attempts?: number; errorCode?: string | null; verifiedAt?: string | null };

export function fetchAiIntegrationVerification(credentials: AuthCredentials, workItemId: string): Promise<AiIntegrationVerification> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/integration-verification`);
}

export function fetchAiSteeringStatus(credentials: AuthCredentials, workItemId: string, steeringId: string): Promise<AiSteeringStatus> {
    return request<unknown>(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/steering/${encodeURIComponent(steeringId)}`).then((value) => AiSteeringStatusSchema.parse(value));
}

export function fetchAiPendingClarifications(credentials: AuthCredentials, conversationId: string): Promise<AiPendingClarification[]> {
    return request<unknown>(credentials, `/v1/ai-team/conversations/${encodeURIComponent(conversationId)}/clarifications?status=pending`)
        .then((value) => pendingClarificationSchema.parse(value).items);
}

export function retryAiSteering(credentials: AuthCredentials, workItemId: string, steeringId: string): Promise<{ status: 'pending' }> {
    return request(credentials, `/v1/ai-team/work-items/${encodeURIComponent(workItemId)}/steering/${encodeURIComponent(steeringId)}/retry`, { method: 'POST' });
}

export function fetchAiSkills(credentials: AuthCredentials): Promise<{ items: AiSkillSummary[] }> {
    return request(credentials, '/v1/ai-team/skills');
}

export function fetchAiSkillDetail(credentials: AuthCredentials, skillId: string): Promise<AiSkillDetail> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}`);
}

export function fetchAiSkillVersion(credentials: AuthCredentials, skillId: string, version: number): Promise<AiSkillVersion> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/versions/${version}`);
}

export function fetchAiSkillProposals(credentials: AuthCredentials, skillId: string): Promise<{ items: AiSkillProposal[] }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/proposals`);
}

export function rollbackAiSkill(credentials: AuthCredentials, skillId: string, version: number): Promise<{ version: number }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/rollback`, {
        method: 'POST', body: JSON.stringify({ version, confirmed: true }),
    });
}

export function createAiSkill(credentials: AuthCredentials, input: { name: string; teamId?: string }): Promise<{ id: string }> {
    return request(credentials, '/v1/ai-team/skills', { method: 'POST', body: JSON.stringify(input) });
}

export function uploadAiSkillVersion(credentials: AuthCredentials, skillId: string, files: AiSkillFile[]): Promise<{ version: number; contentHash: string; duplicate: boolean }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/versions`, { method: 'POST', body: JSON.stringify({ files }) });
}

export function publishAiSkillVersion(credentials: AuthCredentials, skillId: string, version: number): Promise<{ status: 'published'; version: number }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/versions/${version}/publish`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
}

export function bindAiSkillAgent(credentials: AuthCredentials, skillId: string, agentId: string): Promise<{ skillId: string; agentId: string }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/bindings`, { method: 'POST', body: JSON.stringify({ agentId }) });
}

export function unbindAiSkillAgent(credentials: AuthCredentials, skillId: string, agentId: string): Promise<void> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/bindings/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
}

export function proposeAiSkillLearning(credentials: AuthCredentials, skillId: string, text: string): Promise<{ id: string; status: 'pending' }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/proposals`, { method: 'POST', body: JSON.stringify({ text }) });
}

export function reviewAiSkillProposal(credentials: AuthCredentials, skillId: string, proposalId: string, decision: 'accepted' | 'rejected'): Promise<{ status: 'accepted' | 'rejected' }> {
    return request(credentials, `/v1/ai-team/skills/${encodeURIComponent(skillId)}/proposals/${encodeURIComponent(proposalId)}/review`, {
        method: 'POST', body: JSON.stringify({ decision, confirmed: true }),
    });
}

export type AiProject = {
    id: string; name: string; active: boolean; version: number;
    snapshot: null | { kind: 'local' | 'github'; repositoryId: string | null; repository: string | null;
        machineId: string; registeredRepoId: string; registeredKvVersion: number;
        defaultBranch: string; baseCommit: string; snapshotHash: string; commonGitDirHash: string | null };
};
export type AiProjectBinding = { kind: 'local'; machineId: string; registeredRepoId: string;
    registeredKvVersion: number; workingDirectory: string; defaultBranch: string } |
    { kind: 'github'; repositoryId: string; machineId: string; registeredRepoId: string;
        registeredKvVersion: number; workingDirectory: string; defaultBranch: string };

export function fetchAiProjects(credentials: AuthCredentials): Promise<{ items: AiProject[] }> {
    return request(credentials, '/v1/ai-team/projects');
}

export function fetchAiProjectMachineIds(credentials: AuthCredentials): Promise<string[]> {
    return request<unknown>(credentials, '/v1/machines').then((value) => z.array(z.object({ id: z.string(), active: z.boolean() })).parse(value)
        .filter((machine) => machine.active).map((machine) => machine.id));
}

export function createAiProject(credentials: AuthCredentials, input: AiProjectBinding & { name: string; clientRequestId: string }): Promise<AiProject> {
    return request(credentials, '/v1/ai-team/projects', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAiProject(credentials: AuthCredentials, id: string, input: AiProjectBinding & { expectedVersion: number; name?: string; active?: boolean }): Promise<AiProject> {
    return request(credentials, `/v1/ai-team/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export type AiAutopilot = { id: string; name: string; projectId: string; agentId: string; teamId: string | null;
    triggerKind: 'cron' | 'manual' | 'webhook'; cronExpression: string | null; timezone: string | null;
    action: 'create_issue' | 'run_only'; concurrencyPolicy: 'skip' | 'queue' | 'replace';
    catchupLimit: number; enabled: boolean; updatedAt: string };
export type AiAutopilotRun = { id: string; triggerKey: string; plannedAt: string; status: string;
    attempts: number; errorCode: string | null; orchestratorRunId: string | null;
    workItemId: string | null; issueResourceId: string | null };
export type AiAutopilotInput = { projectId: string; agentId: string; teamId?: string; name: string; prompt: string;
    triggerKind: AiAutopilot['triggerKind']; cronExpression?: string; timezone?: string;
    action: AiAutopilot['action']; concurrencyPolicy: AiAutopilot['concurrencyPolicy']; catchupLimit: number };

export function fetchAiAutopilots(credentials: AuthCredentials): Promise<{ items: AiAutopilot[] }> {
    return request(credentials, '/v1/ai-team/autopilots');
}

export function createAiAutopilot(credentials: AuthCredentials, input: AiAutopilotInput): Promise<{ id: string; enabled: false; webhookSecret?: string }> {
    return request(credentials, '/v1/ai-team/autopilots', { method: 'POST', body: JSON.stringify(input) });
}

export function setAiAutopilotEnabled(credentials: AuthCredentials, id: string, enabled: boolean): Promise<{ enabled: boolean }> {
    return request(credentials, `/v1/ai-team/autopilots/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
}

export function runAiAutopilot(credentials: AuthCredentials, id: string, clientRequestId: string): Promise<{ id: string; status: string }> {
    return request(credentials, `/v1/ai-team/autopilots/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify({ clientRequestId }) });
}

export function fetchAiAutopilotRuns(credentials: AuthCredentials, id: string): Promise<{ items: AiAutopilotRun[] }> {
    return request(credentials, `/v1/ai-team/autopilots/${encodeURIComponent(id)}/runs`);
}
