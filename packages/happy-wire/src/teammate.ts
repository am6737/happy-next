import * as z from 'zod';
import { PermissionModeSchema } from './permissionModes';

// Env vars set by the daemon on teammate-spawned sessions.
export const TEAMMATE_ENV = {
  sessionDataKeyFile: 'HAPPY_SESSION_DATA_KEY_FILE',
  teammateId: 'HAPPY_TEAMMATE_ID',
  threadId: 'HAPPY_TEAMMATE_THREAD_ID',
  sessionRole: 'HAPPY_TEAMMATE_SESSION_ROLE',
  taskId: 'HAPPY_TEAMMATE_TASK_ID',
  workerId: 'HAPPY_TEAMMATE_WORKER_ID',
  externalContext: 'HAPPY_TEAMMATE_EXTERNAL_CONTEXT',
  home: 'HAPPY_TEAMMATE_HOME',
  systemPromptFile: 'HAPPY_TEAMMATE_SYSTEM_PROMPT_FILE',
  controlToken: 'HAPPY_TEAMMATE_CONTROL_TOKEN',
  // '1' pins a Codex worker to a read-only sandbox regardless of the message permission mode (review workers).
  readOnly: 'HAPPY_TEAMMATE_READ_ONLY',
} as const;

export const TEAMMATE_STATUSES = ['active', 'paused', 'budget_paused', 'archived'] as const;
export const TEAMMATE_THREAD_KINDS = ['dm', 'group', 'task', 'heartbeat', 'dreaming'] as const;
export const TEAMMATE_RUN_TRIGGERS = [
  'channel-message', 'task-assigned', 'task-update', 'review-feedback', 'work-session-idle', 'heartbeat', 'dreaming', 'retry', 'manual',
] as const;
export const TEAMMATE_RUN_STATUSES = ['queued', 'dispatching', 'running', 'completed', 'failed', 'cancelled'] as const;
export const TEAMMATE_RUN_FAILURE_REASONS = [
  'runtime_offline', 'spawn_failed', 'dispatch_timeout', 'runtime_recovery',
  'budget_exceeded', 'cancelled_by_user', 'session_error', 'unknown',
] as const;
export const TEAMMATE_TASK_STATUSES = [
  'todo', 'in_progress', 'awaiting_input', 'in_review', 'done', 'cancelled', 'paused',
] as const;
export const TEAMMATE_TASK_ACTIVE_STATUSES = ['todo', 'in_progress', 'awaiting_input', 'in_review'] as const;
export const TEAMMATE_TASK_AGENT_STATUSES = ['in_progress', 'awaiting_input', 'in_review', 'done'] as const;
export const TEAMMATE_TASK_SOURCES = ['github-issue', 'chat'] as const;
export const TEAMMATE_SESSION_ROLES = ['controller', 'worker'] as const;
export const TEAMMATE_WORKER_PROVIDERS = ['claude', 'codex', 'gemini'] as const;
// The main session drives the Agent through its MCP tools; only Claude Code and Codex are supported there.
export const TEAMMATE_CONTROLLER_PROVIDERS = ['claude', 'codex'] as const;
export const CHANNEL_KINDS = ['dm', 'group'] as const;
export const CHANNEL_MESSAGE_KINDS = ['text', 'decision', 'report', 'system'] as const;
export const CHANNEL_MEMBER_TYPES = ['user', 'teammate'] as const;
export const CHANNEL_SYSTEM_CODES = [
  'loop_guard', 'member_added', 'context_reset',
  'budget_warning', 'budget_paused', 'budget_resumed', 'task_self_assigned', 'run_failed',
] as const;
export const TEAMMATE_HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{1,31}$/;
export const TEAMMATE_SKILL_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const TEAMMATE_BUDGET_WARNING_RATIO = 0.8;
export const TEAMMATE_TASK_CREATE_DAILY_LIMIT = 20;
export const TEAMMATE_REVIEW_MAX_ROUNDS = 3;

export const TeammateStatusSchema = z.enum(TEAMMATE_STATUSES);
export type TeammateStatus = z.infer<typeof TeammateStatusSchema>;

export const TeammateThreadKindSchema = z.enum(TEAMMATE_THREAD_KINDS);
export type TeammateThreadKind = z.infer<typeof TeammateThreadKindSchema>;

export const TeammateRunTriggerSchema = z.enum(TEAMMATE_RUN_TRIGGERS);
export type TeammateRunTrigger = z.infer<typeof TeammateRunTriggerSchema>;

export const TeammateRunStatusSchema = z.enum(TEAMMATE_RUN_STATUSES);
export type TeammateRunStatus = z.infer<typeof TeammateRunStatusSchema>;

export const TeammateRunFailureReasonSchema = z.enum(TEAMMATE_RUN_FAILURE_REASONS);
export type TeammateRunFailureReason = z.infer<typeof TeammateRunFailureReasonSchema>;

export const TeammateTaskStatusSchema = z.enum(TEAMMATE_TASK_STATUSES);
export type TeammateTaskStatus = z.infer<typeof TeammateTaskStatusSchema>;

export const TeammateTaskSourceSchema = z.enum(TEAMMATE_TASK_SOURCES);
export type TeammateTaskSource = z.infer<typeof TeammateTaskSourceSchema>;

export const TeammateSessionRoleSchema = z.enum(TEAMMATE_SESSION_ROLES);
export type TeammateSessionRole = z.infer<typeof TeammateSessionRoleSchema>;

export const TeammateWorkerProviderSchema = z.enum(TEAMMATE_WORKER_PROVIDERS);
export type TeammateWorkerProvider = z.infer<typeof TeammateWorkerProviderSchema>;

export const TeammateControllerProviderSchema = z.enum(TEAMMATE_CONTROLLER_PROVIDERS);
export type TeammateControllerProvider = z.infer<typeof TeammateControllerProviderSchema>;

export const ChannelKindSchema = z.enum(CHANNEL_KINDS);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

export const ChannelMessageKindSchema = z.enum(CHANNEL_MESSAGE_KINDS);
export type ChannelMessageKind = z.infer<typeof ChannelMessageKindSchema>;

export const ChannelMemberTypeSchema = z.enum(CHANNEL_MEMBER_TYPES);
export type ChannelMemberType = z.infer<typeof ChannelMemberTypeSchema>;

export const ChannelSystemCodeSchema = z.enum(CHANNEL_SYSTEM_CODES);
export type ChannelSystemCode = z.infer<typeof ChannelSystemCodeSchema>;

export const ChannelMessageContentSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('encrypted'), c: z.string() }),
  z.object({ t: z.literal('system'), code: ChannelSystemCodeSchema, data: z.record(z.string(), z.unknown()) }),
]);
export type ChannelMessageContent = z.infer<typeof ChannelMessageContentSchema>;

export const ChannelMemberSchema = z.object({
  memberType: ChannelMemberTypeSchema,
  accountId: z.string().nullable(),
  teammateId: z.string().nullable(),
  encryptedDataKey: z.string(),
  lastReadSeq: z.number().int(),
});
export type ChannelMember = z.infer<typeof ChannelMemberSchema>;

export const ChannelSchema = z.object({
  id: z.string(),
  kind: ChannelKindSchema,
  title: z.string().nullable(),
  seq: z.number().int(),
  lastMessageAt: z.number(),
  createdAt: z.number(),
  members: z.array(ChannelMemberSchema),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const ChannelMessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  seq: z.number().int(),
  localId: z.string().nullable(),
  senderType: ChannelMemberTypeSchema,
  senderId: z.string(),
  content: ChannelMessageContentSchema,
  mentions: z.array(z.string()),
  kind: ChannelMessageKindSchema,
  taskId: z.string().nullable(),
  runId: z.string().nullable(),
  createdAt: z.number(),
});
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

export const ChannelCreateRequestSchema = z.object({
  kind: ChannelKindSchema,
  title: z.string().max(100).nullable().optional(),
  userEncryptedDataKey: z.string(),
  teammates: z.array(z.object({ teammateId: z.string(), encryptedDataKey: z.string() })).min(1).max(20),
});
export type ChannelCreateRequest = z.infer<typeof ChannelCreateRequestSchema>;

export const ChannelMessageSendRequestSchema = z.object({
  localId: z.string().min(1).max(128),
  content: z.object({ t: z.literal('encrypted'), c: z.string() }),
  kind: z.enum(['text', 'decision', 'report']).default('text'),
  mentions: z.array(z.string()).max(20).default([]),
  taskId: z.string().nullable().optional(),
});
export type ChannelMessageSendRequest = z.input<typeof ChannelMessageSendRequestSchema>;
export type ChannelMessageSendRequestParsed = z.infer<typeof ChannelMessageSendRequestSchema>;

// Daemon -> server: a teammate posts into a channel.
export const TeammateChannelMessageSendRequestSchema = ChannelMessageSendRequestSchema.extend({
  runId: z.string(),
  dispatchToken: z.string(),
});
export type TeammateChannelMessageSendRequest = z.input<typeof TeammateChannelMessageSendRequestSchema>;
export type TeammateChannelMessageSendRequestParsed = z.infer<typeof TeammateChannelMessageSendRequestSchema>;

export const ChannelMemberKeyUpdateRequestSchema = z.object({ encryptedDataKey: z.string() });
export type ChannelMemberKeyUpdateRequest = z.infer<typeof ChannelMemberKeyUpdateRequestSchema>;

export const ChannelMarkReadRequestSchema = z.object({ seq: z.number().int().min(0) });
export type ChannelMarkReadRequest = z.infer<typeof ChannelMarkReadRequestSchema>;

export const TeammateAvatarSchema = z.object({
  emoji: z.string().max(16).optional(),
  color: z.string().max(32).optional(),
  imageUrl: z.string().url().optional(),
});
export type TeammateAvatar = z.infer<typeof TeammateAvatarSchema>;

export const TeammateActiveHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
});
export type TeammateActiveHours = z.infer<typeof TeammateActiveHoursSchema>;

export const TeammateSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  avatar: TeammateAvatarSchema.nullable(),
  role: z.string(),
  skills: z.array(z.string()),
  repos: z.array(z.string()),
  instructions: z.string(),
  machineId: z.string(),
  controllerProvider: TeammateControllerProviderSchema,
  controllerModel: z.string().nullable(),
  controllerPermissionMode: PermissionModeSchema,
  controllerProfileId: z.string().nullable(),
  controllerEnv: z.string().nullable(),
  workerProvider: TeammateWorkerProviderSchema,
  // Model catalog ModelMode (e.g. claude-opus-5-high, optional -fast suffix); null is the provider default.
  model: z.string().nullable(),
  workerPermissionMode: PermissionModeSchema,
  workerProfileId: z.string().nullable(),
  workerEnv: z.string().nullable(),
  maxConcurrentRuns: z.number().int(),
  monthlyBudgetUsd: z.number().nullable(),
  timezone: z.string().nullable(),
  heartbeatIntervalMin: z.number().int().nullable(),
  activeHours: TeammateActiveHoursSchema.nullable(),
  dreamingHour: z.number().int().min(0).max(23).nullable(),
  canSelfAssign: z.boolean(),
  status: TeammateStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Teammate = z.infer<typeof TeammateSchema>;

/**
 * Profile environment for one runtime role, encrypted by the app with the bound machine's key
 * (same wrapping as channel keys) so only that daemon can read profile secrets.
 */
export const TeammateRuntimeEnvSchema = z.object({
  environmentVariables: z.record(z.string(), z.string()),
  inheritMachineConfig: z.boolean(),
});
export type TeammateRuntimeEnv = z.infer<typeof TeammateRuntimeEnvSchema>;

export const TeammateCreateRequestSchema = z.object({
  handle: z.string().regex(TEAMMATE_HANDLE_REGEX),
  name: z.string().min(1).max(64),
  avatar: TeammateAvatarSchema.nullable().optional(),
  role: z.string().max(200).default(''),
  skills: z.array(z.string().regex(TEAMMATE_SKILL_NAME_REGEX)).max(50).default([]),
  repos: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/)).max(50).default([]),
  instructions: z.string().max(20000).default(''),
  machineId: z.string().min(1),
  controllerProvider: TeammateControllerProviderSchema.default('claude'),
  controllerModel: z.string().max(100).nullable().optional(),
  controllerPermissionMode: PermissionModeSchema.default('default'),
  controllerProfileId: z.string().max(100).nullable().optional(),
  controllerEnv: z.string().max(65536).nullable().optional(),
  workerProvider: TeammateWorkerProviderSchema.default('claude'),
  model: z.string().max(100).nullable().optional(),
  workerPermissionMode: PermissionModeSchema.default('default'),
  workerProfileId: z.string().max(100).nullable().optional(),
  workerEnv: z.string().max(65536).nullable().optional(),
  maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
  monthlyBudgetUsd: z.number().positive().nullable().optional(),
  timezone: z.string().min(1).max(64).nullable().optional(),
  heartbeatIntervalMin: z.number().int().min(5).max(1440).nullable().optional(),
  activeHours: TeammateActiveHoursSchema.nullable().optional(),
  dreamingHour: z.number().int().min(0).max(23).nullable().optional(),
  canSelfAssign: z.boolean().default(false),
});
export type TeammateCreateRequest = z.input<typeof TeammateCreateRequestSchema>;
export type TeammateCreateRequestParsed = z.output<typeof TeammateCreateRequestSchema>;

// Handles are immutable; archiving has its own endpoint.
export const TeammateUpdateRequestSchema = TeammateCreateRequestSchema.omit({ handle: true }).partial().extend({
  status: z.enum(['active', 'paused']).optional(),
});
export type TeammateUpdateRequest = z.input<typeof TeammateUpdateRequestSchema>;
export type TeammateUpdateRequestParsed = z.output<typeof TeammateUpdateRequestSchema>;

export const TeammateRunSchema = z.object({
  id: z.string(),
  teammateId: z.string(),
  threadId: z.string(),
  threadKind: TeammateThreadKindSchema,
  trigger: TeammateRunTriggerSchema,
  status: TeammateRunStatusSchema,
  attempt: z.number().int(),
  failureReason: TeammateRunFailureReasonSchema.nullable(),
  sessionId: z.string().nullable(),
  taskId: z.string().nullable(),
  costUsd: z.number().nullable(),
  queuedAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type TeammateRun = z.infer<typeof TeammateRunSchema>;

export const TeammateScheduledRunResponseSchema = z.object({ run: TeammateRunSchema });
export type TeammateScheduledRunResponse = z.infer<typeof TeammateScheduledRunResponseSchema>;

export const TeammateManualRunRequestSchema = z.object({
  note: z.string().max(4000).optional(),
});
export type TeammateManualRunRequest = z.infer<typeof TeammateManualRunRequestSchema>;

export const TeammateRunStartedRequestSchema = z.object({
  dispatchToken: z.string(),
  sessionId: z.string(),
  resumed: z.boolean(),
  delivery: z.enum(['sent', 'queued']),
});
export type TeammateRunStartedRequest = z.infer<typeof TeammateRunStartedRequestSchema>;

export const TeammateRunFinishedRequestSchema = z.object({
  dispatchToken: z.string(),
  // Completion is decided by the server turn-end hook.
  status: TeammateRunStatusSchema.extract(['failed', 'cancelled']),
  failureReason: TeammateRunFailureReasonSchema.optional(),
  errorMessage: z.string().max(4000).optional(),
});
export type TeammateRunFinishedRequest = z.infer<typeof TeammateRunFinishedRequestSchema>;

export const TeammateActiveSessionsResponseSchema = z.object({
  sessionIds: z.array(z.string()),
});
export type TeammateActiveSessionsResponse = z.infer<typeof TeammateActiveSessionsResponseSchema>;

export const TeammateTaskSchema = z.object({
  id: z.string(),
  teammateId: z.string(),
  createdByTeammateId: z.string().nullable(),
  source: TeammateTaskSourceSchema,
  resourceId: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  status: TeammateTaskStatusSchema,
  summary: z.string().nullable(),
  prUrl: z.string().nullable(),
  reviewerTeammateId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  reviewRound: z.number().int().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TeammateTask = z.infer<typeof TeammateTaskSchema>;

export const GithubIssueResourceIdSchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/);
export type GithubIssueResourceId = z.infer<typeof GithubIssueResourceIdSchema>;

export const TeammateTaskDelegateRequestSchema = z.object({
  teammateId: z.string().min(1),
  source: z.literal('github-issue').default('github-issue'),
  resourceId: GithubIssueResourceIdSchema,
  title: z.string().min(1).max(500),
  url: z.string().url().optional(),
  prUrl: z.string().url().optional(),
});
export type TeammateTaskDelegateRequest = z.input<typeof TeammateTaskDelegateRequestSchema>;
export type TeammateTaskDelegateRequestParsed = z.infer<typeof TeammateTaskDelegateRequestSchema>;

// Agents write handles the way they appear in chat ("@builder"); the stored handle has no "@".
const TaskHandleSchema = z.string().transform(handle => handle.replace(/^@/, '')).pipe(z.string().regex(TEAMMATE_HANDLE_REGEX));

export const TeammateTaskCreateRequestSchema = z.object({
  runId: z.string(),
  dispatchToken: z.string(),
  requestId: z.string().min(1).max(200),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  issueNumber: z.number().int().positive().optional(),
  title: z.string().min(1).max(256).optional(),
  body: z.string().max(20000).optional(),
  assignee: TaskHandleSchema.optional(),
  reviewer: TaskHandleSchema.optional(),
}).refine(v => (v.issueNumber === undefined) !== (v.title === undefined), 'Provide exactly one of issueNumber or title');
export type TeammateTaskCreateRequest = z.infer<typeof TeammateTaskCreateRequestSchema>;

export const TeammateTaskCreateResponseSchema = z.object({
  task: TeammateTaskSchema,
  issueUrl: z.string(),
  created: z.boolean(),
});
export type TeammateTaskCreateResponse = z.infer<typeof TeammateTaskCreateResponseSchema>;

export const TeammateTaskSessionSchema = z.object({
  sessionId: z.string(),
  role: TeammateSessionRoleSchema,
  createdAt: z.number(),
});
export type TeammateTaskSession = z.infer<typeof TeammateTaskSessionSchema>;

export const TeammateTaskDetailSchema = z.object({
  task: TeammateTaskSchema,
  sessions: z.array(TeammateTaskSessionSchema),
  runs: z.array(TeammateRunSchema),
});
export type TeammateTaskDetail = z.infer<typeof TeammateTaskDetailSchema>;

// Daemon -> server: authorized with the run's dispatch token.
export const TeammateTaskAgentUpdateRequestSchema = z.object({
  runId: z.string(),
  dispatchToken: z.string(),
  status: z.enum(TEAMMATE_TASK_AGENT_STATUSES).optional(),
  summary: z.string().max(4000).optional(),
  prUrl: z.string().url().optional(),
  verdict: z.enum(['approved', 'changes_requested']).optional(),
}).refine(v => v.status !== undefined || v.summary !== undefined || v.prUrl !== undefined || v.verdict !== undefined)
  .refine(v => v.verdict === undefined || (v.summary !== undefined && v.summary.trim().length > 0), {
    message: 'summary is required when verdict is present',
  });
export type TeammateTaskAgentUpdateRequest = z.infer<typeof TeammateTaskAgentUpdateRequestSchema>;

export const TeammateTaskCommentRequestSchema = z.object({
  runId: z.string(),
  dispatchToken: z.string(),
  body: z.string().min(1).max(60000),
});
export type TeammateTaskCommentRequest = z.infer<typeof TeammateTaskCommentRequestSchema>;

export const TeammateTaskCommentResponseSchema = z.object({ url: z.string() });
export type TeammateTaskCommentResponse = z.infer<typeof TeammateTaskCommentResponseSchema>;

export const TeammateSessionRegisterRequestSchema = z.object({
  runId: z.string(),
  dispatchToken: z.string(),
  sessionId: z.string(),
  role: z.literal('worker'),
});
export type TeammateSessionRegisterRequest = z.infer<typeof TeammateSessionRegisterRequestSchema>;

export const TeammateSpendSchema = z.object({
  teammateId: z.string(),
  monthStart: z.number(),
  spentUsd: z.number(),
  budgetUsd: z.number().nullable(),
});
export type TeammateSpend = z.infer<typeof TeammateSpendSchema>;

// Decrypted channel message body, used from M3.
export const ChannelMessageBodySchema = z.object({
  text: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  links: z.array(z.object({
    kind: z.enum(['session', 'pr', 'issue', 'url']),
    title: z.string().optional(),
    url: z.string().optional(),
    sessionId: z.string().optional(),
  })).optional(),
});
export type ChannelMessageBody = z.infer<typeof ChannelMessageBodySchema>;

// Stored as metadata.teammate in a session.
export const TeammateSessionMetadataSchema = z.object({
  id: z.string(),
  role: TeammateSessionRoleSchema,
  threadId: z.string(),
  taskId: z.string().optional(),
});
export type TeammateSessionMetadata = z.infer<typeof TeammateSessionMetadataSchema>;

export const TEAMMATE_RPC_RUN_DISPATCH = 'teammate-run-dispatch';
export const TEAMMATE_RPC_RUN_CANCEL = 'teammate-run-cancel';
export const TEAMMATE_RPC_TASK_STOP = 'teammate-task-stop';
export const TEAMMATE_RPC_NOTIFY = 'teammate-notify';
export const TEAMMATE_RPC_DRAFT = 'teammate-draft';
export const TEAMMATE_RPC_LIST_SKILLS = 'teammate-list-skills';

export const TeammateSkillSourceSchema = z.enum(['claude', 'codex', 'agents']);
export type TeammateSkillSource = z.infer<typeof TeammateSkillSourceSchema>;

export const TeammateSkillScopeSchema = z.enum(['USER', 'REPO', 'ADMIN', 'SYSTEM']);
export type TeammateSkillScope = z.infer<typeof TeammateSkillScopeSchema>;

// Discovery returns metadata only; SKILL.md bodies are never sent over this RPC.
export const TeammateSkillInfoSchema = z.object({
  name: z.string().max(64),
  description: z.string().max(2000),
  source: TeammateSkillSourceSchema,
  scope: TeammateSkillScopeSchema,
  path: z.string().max(1024),
});
export type TeammateSkillInfo = z.infer<typeof TeammateSkillInfoSchema>;

export const TeammateListSkillsRequestSchema = z.object({});
export type TeammateListSkillsRequest = z.infer<typeof TeammateListSkillsRequestSchema>;

export const TeammateListSkillsResponseSchema = z.object({
  skills: z.array(TeammateSkillInfoSchema).max(500),
});
export type TeammateListSkillsResponse = z.infer<typeof TeammateListSkillsResponseSchema>;

// AI-assisted creation: the daemon runs one tool-less Claude turn that turns a
// free-form description into these fields; the user reviews them before saving.
export const TeammateDraftSchema = z.object({
  name: z.string().max(64),
  handle: z.string().max(32),
  role: z.string().max(200),
  skills: z.array(z.string().max(64)).max(12),
  instructions: z.string().max(20000),
  avatar: z.object({
    emoji: z.string().max(16).optional(),
    color: z.string().max(32).optional(),
  }).optional(),
});
export type TeammateDraft = z.infer<typeof TeammateDraftSchema>;

// A clarifying question the builder asks back, with tappable suggested answers.
export const TeammateDraftQuestionSchema = z.object({
  question: z.string().max(300),
  suggestions: z.array(z.string().max(120)).max(4),
});
export type TeammateDraftQuestion = z.infer<typeof TeammateDraftQuestionSchema>;

export const TeammateDraftAnswerSchema = z.object({
  question: z.string().max(300),
  answer: z.string().max(2000),
});
export type TeammateDraftAnswer = z.infer<typeof TeammateDraftAnswerSchema>;

// Stateless guided creation: every round re-sends the description, the full
// Q&A history and the latest draft, so no builder session lives anywhere.
export const TeammateDraftRequestSchema = z.object({
  description: z.string().min(1).max(4000),
  answers: z.array(TeammateDraftAnswerSchema).max(20).optional(),
  // Free-form refinement of `previous`, e.g. "make it stricter about tests".
  feedback: z.string().max(2000).optional(),
  previous: TeammateDraftSchema.optional(),
  // BCP-47 tag of the app language; names stay as described, prose follows it.
  locale: z.string().max(16).optional(),
  model: z.string().max(100).optional(),
});
export type TeammateDraftRequest = z.infer<typeof TeammateDraftRequestSchema>;

export const TeammateDraftResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    draft: TeammateDraftSchema,
    // Empty once the builder has nothing important left to ask.
    questions: z.array(TeammateDraftQuestionSchema).max(3).default([]),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TeammateDraftResponse = z.infer<typeof TeammateDraftResponseSchema>;

export const TeammateNotifyPayloadSchema = z.object({
  teammateId: z.string(),
  title: z.string().max(120),
  body: z.string().max(500),
  data: z.record(z.string(), z.unknown()),
});
export type TeammateNotifyPayload = z.infer<typeof TeammateNotifyPayloadSchema>;

export const TeammateRunEventSchema = z.object({
  type: TeammateRunTriggerSchema,
  at: z.number(),
  // Standardized keys: channelId, messageId, seq, taskId, sessionId, note.
  data: z.record(z.string(), z.unknown()),
});
export type TeammateRunEvent = z.infer<typeof TeammateRunEventSchema>;

export const TeammateRunDispatchPayloadSchema = z.object({
  runId: z.string(),
  dispatchToken: z.string(),
  attempt: z.number().int(),
  teammate: TeammateSchema,
  thread: z.object({
    id: z.string(),
    kind: TeammateThreadKindSchema,
    channelId: z.string().nullable(),
    taskId: z.string().nullable(),
    providerSessionId: z.string().nullable(),
    currentSessionId: z.string().nullable(),
    resetAt: z.number().nullable(),
  }),
  channel: z.object({
    id: z.string(),
    kind: ChannelKindSchema,
    title: z.string().nullable(),
    teammateEncryptedDataKey: z.string(),
    members: z.array(z.object({
      memberType: ChannelMemberTypeSchema,
      id: z.string(),
      name: z.string(),
      handle: z.string().nullable(),
    })),
  }).nullable(),
  task: TeammateTaskSchema.nullable(),
  trigger: TeammateRunTriggerSchema,
  events: z.array(TeammateRunEventSchema),
});
export type TeammateRunDispatchPayload = z.infer<typeof TeammateRunDispatchPayloadSchema>;

export const TeammateRunCancelPayloadSchema = z.object({
  runId: z.string(),
  dispatchToken: z.string(),
  reason: z.string().optional(),
});
export type TeammateRunCancelPayload = z.infer<typeof TeammateRunCancelPayloadSchema>;

export const TeammateTaskStopPayloadSchema = z.object({
  teammateId: z.string(),
  taskId: z.string(),
  reason: z.enum(['paused', 'cancelled', 'done', 'run_limit', 'budget']),
});
export type TeammateTaskStopPayload = z.infer<typeof TeammateTaskStopPayloadSchema>;

export const TeammateRpcResultSchema = z.object({
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  sessionId: z.string().optional(),
  errorCode: TeammateRunFailureReasonSchema.optional(),
  errorMessage: z.string().optional(),
});
export type TeammateRpcResult = z.infer<typeof TeammateRpcResultSchema>;
