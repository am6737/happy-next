import { describe, expect, it } from 'vitest';
import {
  CHANNEL_SYSTEM_CODES,
  ChannelCreateRequestSchema,
  ChannelMessageContentSchema,
  ChannelMessageSendRequestSchema,
  GithubIssueResourceIdSchema,
  TEAMMATE_ENV,
  TEAMMATE_HANDLE_REGEX,
  TEAMMATE_BUDGET_WARNING_RATIO,
  TEAMMATE_TASK_CREATE_DAILY_LIMIT,
  TEAMMATE_RPC_NOTIFY,
  TEAMMATE_RPC_LIST_SKILLS,
  TEAMMATE_RPC_TASK_STOP,
  TEAMMATE_SKILL_NAME_REGEX,
  TEAMMATE_TASK_ACTIVE_STATUSES,
  TEAMMATE_TASK_AGENT_STATUSES,
  TeammateChannelMessageSendRequestSchema,
  TeammateActiveSessionsResponseSchema,
  TeammateCreateRequestSchema,
  TeammateManualRunRequestSchema,
  TeammateNotifyPayloadSchema,
  TeammateRpcResultSchema,
  TeammateScheduledRunResponseSchema,
  TeammateSchema,
  TeammateSkillInfoSchema,
  TeammateListSkillsRequestSchema,
  TeammateListSkillsResponseSchema,
  TeammateRunDispatchPayloadSchema,
  TeammateRunFinishedRequestSchema,
  TeammateContextEventRequestSchema,
  TEAMMATE_CONTEXT_ROLLED_REASONS,
  TeammateRunStartedRequestSchema,
  TeammateSessionRegisterRequestSchema,
  TeammateTaskAgentUpdateRequestSchema,
  TeammateTaskCommentRequestSchema,
  TeammateTaskCommentResponseSchema,
  TeammateTaskCreateRequestSchema,
  TeammateTaskCreateResponseSchema,
  TeammateTaskDelegateRequestSchema,
  TeammateTaskDetailSchema,
  TeammateTaskSessionSchema,
  TeammateTaskSchema,
  TeammateTaskStopPayloadSchema,
  TeammateUpdateRequestSchema,
  type ChannelMessageSendRequest,
  type ChannelMessageSendRequestParsed,
  type TeammateChannelMessageSendRequest,
  type TeammateChannelMessageSendRequestParsed,
  type TeammateCreateRequest,
  type TeammateCreateRequestParsed,
  type TeammateRunDispatchPayload,
  type TeammateTask,
  type TeammateTaskDelegateRequest,
  type TeammateTaskDelegateRequestParsed,
  type TeammateUpdateRequest,
  type TeammateUpdateRequestParsed,
} from './teammate';

describe('teammate contract', () => {
  it('uses the exact runtime environment variable names', () => {
    expect(TEAMMATE_ENV).toEqual({
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
      readOnly: 'HAPPY_TEAMMATE_READ_ONLY',
    });
    expect(TEAMMATE_ENV.controlToken).toBe('HAPPY_TEAMMATE_CONTROL_TOKEN');
  });

  it('uses the exact task RPC and status constants', () => {
    expect(TEAMMATE_RPC_TASK_STOP).toBe('teammate-task-stop');
    expect(TEAMMATE_TASK_ACTIVE_STATUSES).toEqual(['todo', 'in_progress', 'awaiting_input', 'in_review']);
    expect(TEAMMATE_TASK_AGENT_STATUSES).toEqual(['in_progress', 'awaiting_input', 'in_review', 'done']);
    expect(TEAMMATE_RPC_NOTIFY).toBe('teammate-notify');
    expect(TEAMMATE_BUDGET_WARNING_RATIO).toBe(0.8);
    expect(TEAMMATE_TASK_CREATE_DAILY_LIMIT).toBe(20);
  });

  it('defines the list-skills RPC contract', () => {
    expect(TEAMMATE_RPC_LIST_SKILLS).toBe('teammate-list-skills');
    expect(TeammateListSkillsRequestSchema.parse({})).toEqual({});

    const response = {
      skills: [{
        name: 'typescript',
        description: 'TypeScript coding guidance',
        source: 'codex',
        scope: 'USER',
        path: '/home/coder/.codex/skills/typescript',
      }],
    };
    expect(TeammateListSkillsResponseSchema.parse(response)).toEqual(response);
    expect(TeammateListSkillsResponseSchema.safeParse({
      skills: [{ ...response.skills[0], description: undefined }],
    }).success).toBe(false);
    expect(TeammateSkillInfoSchema.parse(response.skills[0])).toEqual(response.skills[0]);
    expect(TeammateListSkillsResponseSchema.parse({ skills: [] })).toEqual({ skills: [] });
    expect(TeammateListSkillsResponseSchema.safeParse({ skills: Array(500).fill(response.skills[0]) }).success).toBe(true);
    expect(TeammateListSkillsResponseSchema.safeParse({ skills: Array(501).fill(response.skills[0]) }).success).toBe(false);
  });

  it('enforces skill metadata bounds and source/scope values', () => {
    const skill = {
      name: 'a'.repeat(64),
      description: 'd'.repeat(2000),
      source: 'claude',
      scope: 'USER',
      path: 'p'.repeat(1024),
    };
    for (const source of ['claude', 'codex', 'agents']) {
      for (const scope of ['USER', 'REPO', 'ADMIN', 'SYSTEM']) {
        expect(TeammateSkillInfoSchema.safeParse({ ...skill, source, scope }).success).toBe(true);
      }
    }
    for (const invalid of [
      { name: 'a'.repeat(65) },
      { description: 'd'.repeat(2001) },
      { path: 'p'.repeat(1025) },
      { source: 'gemini' },
      { scope: 'user' },
    ]) {
      expect(TeammateSkillInfoSchema.safeParse({ ...skill, ...invalid }).success).toBe(false);
    }
  });

  it.each(['typescript', 'a.b-c_1', 'A', 'a'.repeat(64)])('accepts valid skill name %s for create and update', (skill) => {
    const base = { handle: 'atlas', name: 'Atlas', machineId: 'machine-1' };
    expect(TEAMMATE_SKILL_NAME_REGEX.test(skill)).toBe(true);
    expect(TeammateCreateRequestSchema.safeParse({ ...base, skills: [skill] }).success).toBe(true);
    expect(TeammateUpdateRequestSchema.safeParse({ skills: [skill] }).success).toBe(true);
  });

  it.each(['../x', 'a/b', '.hidden', '', 'a'.repeat(65)])('rejects invalid skill name %j for create and update', (skill) => {
    const base = { handle: 'atlas', name: 'Atlas', machineId: 'machine-1' };
    expect(TEAMMATE_SKILL_NAME_REGEX.test(skill)).toBe(false);
    expect(TeammateCreateRequestSchema.safeParse({ ...base, skills: [skill] }).success).toBe(false);
    expect(TeammateUpdateRequestSchema.safeParse({ skills: [skill] }).success).toBe(false);
  });

  it('limits create and update requests to 50 skills', () => {
    const base = { handle: 'atlas', name: 'Atlas', machineId: 'machine-1' };
    const skills = Array.from({ length: 50 }, (_, index) => `skill-${index}`);
    expect(TeammateCreateRequestSchema.safeParse({ ...base, skills }).success).toBe(true);
    expect(TeammateUpdateRequestSchema.safeParse({ skills }).success).toBe(true);
    const tooManySkills = [...skills, 'extra'];
    expect(TeammateCreateRequestSchema.safeParse({ ...base, skills: tooManySkills }).success).toBe(false);
    expect(TeammateUpdateRequestSchema.safeParse({ skills: tooManySkills }).success).toBe(false);
  });

  const createTask = { runId: 'run-1', dispatchToken: 'token-1', requestId: 'tc:run-1:1', repo: 'owner/repo' };

  it('accepts either an existing issue or a new issue title', () => {
    const existing = { ...createTask, issueNumber: 12, assignee: 'agent_1', reviewer: 'reviewer_1' };
    const newIssue = { ...createTask, title: 'Fix build', body: 'Details' };
    expect(TeammateTaskCreateRequestSchema.parse(existing)).toEqual(existing);
    expect(TeammateTaskCreateRequestSchema.parse(newIssue)).toEqual(newIssue);
  });

  it('requires exactly one of issueNumber and title', () => {
    for (const request of [createTask, { ...createTask, issueNumber: 1, title: 'Fix build' }]) {
      const result = TeammateTaskCreateRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue => issue.message === 'Provide exactly one of issueNumber or title')).toBe(true);
    }
  });

  it.each(['owner/repo/extra', 'owner/re po', '/repo', 'owner/', 'owner\\n/repo'])('rejects invalid task repo %j', (repo) => {
    expect(TeammateTaskCreateRequestSchema.safeParse({ ...createTask, repo, issueNumber: 1 }).success).toBe(false);
  });

  it.each([['@Code Reviewer', 'Code Reviewer'], [' 小明 ', '小明'], ['@builder', 'builder']])('normalizes task agent reference %j', (reviewer, expected) => {
    expect(TeammateTaskCreateRequestSchema.parse({ ...createTask, issueNumber: 1, assignee: reviewer, reviewer }).reviewer).toBe(expected);
  });

  it.each(['', '@', ' @ ', 'x'.repeat(65)])('rejects invalid task agent reference %j', (assignee) => {
    expect(TeammateTaskCreateRequestSchema.safeParse({ ...createTask, issueNumber: 1, assignee }).success).toBe(false);
  });

  it('enforces task creation field bounds', () => {
    const valid = { ...createTask, title: 'x'.repeat(256), body: 'x'.repeat(20000), requestId: 'x'.repeat(200) };
    expect(TeammateTaskCreateRequestSchema.safeParse(valid).success).toBe(true);
    for (const request of [
      { ...valid, title: '' }, { ...valid, title: 'x'.repeat(257) },
      { ...valid, body: 'x'.repeat(20001) }, { ...valid, requestId: '' },
      { ...valid, requestId: 'x'.repeat(201) }, { ...createTask, issueNumber: 0 },
      { ...createTask, issueNumber: 1.5 },
    ]) expect(TeammateTaskCreateRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each(['owner/repo#12', 'a.b/c-d#1'])('accepts GitHub issue resourceId %s', (resourceId) => {
    expect(GithubIssueResourceIdSchema.parse(resourceId)).toBe(resourceId);
  });

  it.each(['owner/repo#0', 'owner#1', 'owner/repo'])('rejects GitHub issue resourceId %s', (resourceId) => {
    expect(GithubIssueResourceIdSchema.safeParse(resourceId).success).toBe(false);
  });

  it('defaults task delegation source to github-issue', () => {
    const request: TeammateTaskDelegateRequest = {
      teammateId: 'teammate-1', resourceId: 'owner/repo#12', title: 'Fix issue #12',
    };
    const parsed: TeammateTaskDelegateRequestParsed = TeammateTaskDelegateRequestSchema.parse(request);
    expect(parsed).toEqual({ ...request, source: 'github-issue' });
  });

  it('rejects a task agent update with no update fields', () => {
    expect(TeammateTaskAgentUpdateRequestSchema.safeParse({
      runId: 'run-1', dispatchToken: 'token-1',
    }).success).toBe(false);
  });

  it.each([
    { status: 'in_progress' },
    { status: 'awaiting_input' },
    { status: 'in_review' },
    { status: 'done' },
    { summary: 'Ready for review' },
    { summary: '' },
    { prUrl: 'https://github.com/owner/repo/pull/1' },
  ])('accepts a task agent update with only %j', (update) => {
    const request = { runId: 'run-1', dispatchToken: 'token-1', ...update };
    expect(TeammateTaskAgentUpdateRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    { status: 'todo' }, { status: 'paused' }, { status: 'cancelled' },
    { summary: 'a'.repeat(4001) }, { prUrl: 'invalid-url' },
  ])('rejects invalid task agent update fields %#', (update) => {
    expect(TeammateTaskAgentUpdateRequestSchema.safeParse({
      runId: 'run-1', dispatchToken: 'token-1', ...update,
    }).success).toBe(false);
  });

  it('validates task comment requests and responses', () => {
    const request = { runId: 'run-1', dispatchToken: 'token-1', body: 'Working on this issue.' };
    expect(TeammateTaskCommentRequestSchema.parse(request)).toEqual(request);
    expect(TeammateTaskCommentRequestSchema.safeParse({ ...request, body: '' }).success).toBe(false);
    expect(TeammateTaskCommentRequestSchema.safeParse({ ...request, body: 'a'.repeat(60001) }).success).toBe(false);
    const response = { url: 'https://github.com/owner/repo/issues/12#issuecomment-1' };
    expect(TeammateTaskCommentResponseSchema.parse(response)).toEqual(response);
  });

  it('registers worker sessions and rejects controller registration', () => {
    const request = { runId: 'run-1', dispatchToken: 'token-1', sessionId: 'session-1', role: 'worker' };
    expect(TeammateSessionRegisterRequestSchema.parse(request)).toEqual(request);
    expect(TeammateSessionRegisterRequestSchema.safeParse({ ...request, role: 'controller' }).success).toBe(false);
  });

  it.each(['paused', 'cancelled', 'done', 'run_limit', 'budget'])('parses a task stop payload with reason %s', (reason) => {
    const payload = { teammateId: 'teammate-1', taskId: 'task-1', reason };
    expect(TeammateTaskStopPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('accepts encrypted channel message content', () => {
    const content = { t: 'encrypted', c: 'ciphertext' };
    expect(ChannelMessageContentSchema.parse(content)).toEqual(content);
  });

  it.each(CHANNEL_SYSTEM_CODES)('accepts system channel message code %s', (code) => {
    const content = { t: 'system', code, data: { teammateId: 'teammate-1', seq: 5 } };
    expect(ChannelMessageContentSchema.parse(content)).toEqual(content);
  });

  it('includes every M5 system code', () => {
    expect(CHANNEL_SYSTEM_CODES).toEqual(expect.arrayContaining([
      'budget_warning', 'budget_paused', 'budget_resumed', 'task_self_assigned',
    ]));
  });

  it('accepts context rolled events', () => {
    expect(TEAMMATE_CONTEXT_ROLLED_REASONS).toEqual(['tokens', 'compacted']);
    expect(TeammateContextEventRequestSchema.parse({
      code: 'context_rolled', dispatchToken: 'token-1', provider: 'claude', reason: 'tokens', segment: 2,
    })).toMatchObject({ code: 'context_rolled', segment: 2 });
  });

  it('accepts skipped dispatch acknowledgements and rejects non-boolean skipped values', () => {
    expect(TeammateRpcResultSchema.parse({ ok: true, skipped: true })).toEqual({ ok: true, skipped: true });
    expect(TeammateRpcResultSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(TeammateRpcResultSchema.safeParse({ ok: true, skipped: 'true' }).success).toBe(false);
  });

  it('enforces notification payload limits', () => {
    const payload = { teammateId: 'teammate-1', title: 't'.repeat(120), body: 'b'.repeat(500), data: { count: 2 } };
    expect(TeammateNotifyPayloadSchema.parse(payload)).toEqual(payload);
    expect(TeammateNotifyPayloadSchema.safeParse({ ...payload, title: 't'.repeat(121) }).success).toBe(false);
    expect(TeammateNotifyPayloadSchema.safeParse({ ...payload, body: 'b'.repeat(501) }).success).toBe(false);
    expect(TeammateNotifyPayloadSchema.safeParse({ ...payload, data: [] }).success).toBe(false);
  });

  it('rejects unknown channel content discriminants and system codes', () => {
    expect(ChannelMessageContentSchema.safeParse({ t: 'unknown', c: 'ciphertext' }).success).toBe(false);
    expect(ChannelMessageContentSchema.safeParse({ t: 'system', code: 'unknown', data: {} }).success).toBe(false);
  });

  it('rejects a DM create request with no teammates', () => {
    expect(ChannelCreateRequestSchema.safeParse({
      kind: 'dm', userEncryptedDataKey: 'user-key', teammates: [],
    }).success).toBe(false);
    const request = {
      kind: 'dm', userEncryptedDataKey: 'user-key',
      teammates: [{ teammateId: 'teammate-1', encryptedDataKey: 'teammate-key' }],
    };
    expect(ChannelCreateRequestSchema.parse(request)).toEqual(request);
  });

  it('defaults user and teammate send requests to text with no mentions', () => {
    const request: ChannelMessageSendRequest = {
      localId: 'local-1', content: { t: 'encrypted', c: 'ciphertext' },
    };
    const parsed: ChannelMessageSendRequestParsed = ChannelMessageSendRequestSchema.parse(request);
    expect(parsed).toEqual({ ...request, kind: 'text', mentions: [] });

    const teammateRequest: TeammateChannelMessageSendRequest = {
      ...request, runId: 'run-1', dispatchToken: 'dispatch-token-1',
    };
    const teammateParsed: TeammateChannelMessageSendRequestParsed = TeammateChannelMessageSendRequestSchema.parse(teammateRequest);
    expect(teammateParsed).toEqual({ ...teammateRequest, kind: 'text', mentions: [] });
  });

  it('rejects system content and system kind in send requests', () => {
    const request = { localId: 'local-1', content: { t: 'encrypted', c: 'ciphertext' } };
    expect(ChannelMessageSendRequestSchema.safeParse({ ...request, kind: 'system' }).success).toBe(false);
    expect(ChannelMessageSendRequestSchema.safeParse({
      ...request, content: { t: 'system', code: 'context_reset', data: {} },
    }).success).toBe(false);
  });

  it('accepts an optional manual run note of at most 4000 characters', () => {
    expect(TeammateManualRunRequestSchema.parse({})).toEqual({});
    const request = { note: 'a'.repeat(4000) };
    expect(TeammateManualRunRequestSchema.parse(request)).toEqual(request);
    expect(TeammateManualRunRequestSchema.safeParse({ note: 'a'.repeat(4001) }).success).toBe(false);
  });

  it.each(['sent', 'queued'])('accepts started delivery %s', (delivery) => {
    const request = { dispatchToken: 'token-1', sessionId: 'session-1', resumed: true, delivery };
    expect(TeammateRunStartedRequestSchema.parse(request)).toEqual(request);
  });

  it.each([undefined, null, '', 'completed', 'pending'])('rejects started delivery %j', (delivery) => {
    const request = { dispatchToken: 'token-1', sessionId: 'session-1', resumed: false, delivery };
    const parsed = TeammateRunStartedRequestSchema.safeParse(request);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['delivery']);
    }
  });

  it.each(['failed', 'cancelled'])('accepts finished status %s', (status) => {
    const request = { dispatchToken: 'token-1', status };
    expect(TeammateRunFinishedRequestSchema.parse(request)).toEqual(request);
  });

  it.each(['queued', 'dispatching', 'running', 'completed'])('rejects finished status %s', (status) => {
    const parsed = TeammateRunFinishedRequestSchema.safeParse({ dispatchToken: 'token-1', status });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['status']);
    }
  });

  it('validates optional failure details and limits error messages to 4000 characters', () => {
    const request = {
      dispatchToken: 'token-1', status: 'failed', failureReason: 'spawn_failed', errorMessage: 'a'.repeat(4000),
    };
    expect(TeammateRunFinishedRequestSchema.parse(request)).toEqual(request);
    expect(TeammateRunFinishedRequestSchema.safeParse({ ...request, failureReason: 'invalid' }).success).toBe(false);
    expect(TeammateRunFinishedRequestSchema.safeParse({ ...request, errorMessage: 'a'.repeat(4001) }).success).toBe(false);
  });

  it('validates context events', () => {
    const compacted = {
      code: 'context_compacted', dispatchToken: 'token-1', provider: 'claude', compactions: 2,
    } as const;
    expect(TeammateContextEventRequestSchema.parse(compacted)).toEqual(compacted);
    const lost = {
      code: 'context_lost', dispatchToken: 'token-1', provider: 'codex', reason: 'resume_failed',
    } as const;
    expect(TeammateContextEventRequestSchema.parse(lost)).toEqual(lost);
    expect(TeammateContextEventRequestSchema.safeParse({ ...compacted, compactions: 0 }).success).toBe(false);
    expect(TeammateContextEventRequestSchema.safeParse({ ...lost, reason: 'unknown' }).success).toBe(false);
    expect(TeammateContextEventRequestSchema.safeParse({ ...lost, provider: 'gemini' }).success).toBe(false);
  });

  it('accepts active session ids, including an empty list, and rejects non-string ids', () => {
    expect(TeammateActiveSessionsResponseSchema.parse({ sessionIds: [] })).toEqual({ sessionIds: [] });
    const response = { sessionIds: ['session-1', 'session-2'] };
    expect(TeammateActiveSessionsResponseSchema.parse(response)).toEqual(response);
    expect(TeammateActiveSessionsResponseSchema.safeParse({ sessionIds: [123] }).success).toBe(false);
  });

  it.each(['ab', 'a0', '0a', 'backend_engineer', 'agent-01', 'a'.repeat(32)])(
    'accepts handle %s', (handle) => {
      expect(TEAMMATE_HANDLE_REGEX.test(handle)).toBe(true);
      expect(TeammateCreateRequestSchema.safeParse({ handle, name: 'Atlas', machineId: 'machine-1' }).success).toBe(true);
    },
  );

  it.each(['', 'a', 'a'.repeat(33), 'Atlas', '_atlas', '-atlas', 'at las', 'atlas.dev', 'atlas/dev', '数字员工', 'atlas\n'])(
    'rejects handle %j', (handle) => {
      expect(TEAMMATE_HANDLE_REGEX.test(handle)).toBe(false);
      expect(TeammateCreateRequestSchema.safeParse({ handle, name: 'Atlas', machineId: 'machine-1' }).success).toBe(false);
    },
  );

  it('treats the handle as an optional hint and trims the name', () => {
    expect(TeammateCreateRequestSchema.parse({ name: '  Code Reviewer ', machineId: 'machine-1' })).toMatchObject({ name: 'Code Reviewer' });
    expect(TeammateCreateRequestSchema.parse({ name: '小明', machineId: 'machine-1' }).handle).toBeUndefined();
  });

  it.each(['', '   ', 'a@b', 'two\nlines', 'x'.repeat(65)])('rejects name %j', (name) => {
    expect(TeammateCreateRequestSchema.safeParse({ name, machineId: 'machine-1' }).success).toBe(false);
  });

  it('applies create defaults while leaving optional configuration absent', () => {
    const request: TeammateCreateRequest = { handle: 'atlas', name: 'Atlas', machineId: 'machine-1' };
    const parsed: TeammateCreateRequestParsed = TeammateCreateRequestSchema.parse(request);

    expect(parsed).toEqual({
      ...request,
      role: '',
      skills: [],
      repos: [],
      instructions: '',
      controllerProvider: 'claude',
      controllerPermissionMode: 'default',
      workerProvider: 'claude',
      workerPermissionMode: 'default',
      maxConcurrentRuns: 3,
      canSelfAssign: false,
    });
  });

  it('strips handle changes from updates and preserves editable fields', () => {
    const parsed = TeammateUpdateRequestSchema.parse({ handle: 'new-handle', name: 'New name', status: 'paused' });

    expect(parsed).toEqual({ name: 'New name', status: 'paused' });
    expect(parsed).not.toHaveProperty('handle');
    expect(TeammateUpdateRequestSchema.parse({ handle: 'new-handle' })).toEqual({});
  });

  it('keeps omitted update fields absent instead of applying create defaults', () => {
    const request: TeammateUpdateRequest = {};
    const parsed: TeammateUpdateRequestParsed = TeammateUpdateRequestSchema.parse(request);

    expect(parsed).toEqual({});
  });

  it.each(['active', 'paused'])('accepts update status %s', (status) => {
    expect(TeammateUpdateRequestSchema.parse({ status })).toEqual({ status });
  });

  it.each(['archived', 'budget_paused'])('rejects update status %s', (status) => {
    const parsed = TeammateUpdateRequestSchema.safeParse({ status });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['status']);
    }
  });

  const task: TeammateTask = {
    id: 'task-1',
    teammateId: 'teammate-1',
    source: 'github-issue',
    resourceId: 'happy-next/happy-next#123',
    title: 'Fix issue #123',
    url: 'https://github.com/happy-next/happy-next/issues/123',
    status: 'todo',
    summary: null,
    prUrl: null,
    createdByTeammateId: null,
    createdAt: 1791417600000,
    updatedAt: 1791417660000,
  };

  it('requires the task creator field and parses task creation responses', () => {
    expect(TeammateTaskSchema.parse(task)).toEqual(task);
    const { createdByTeammateId, ...withoutCreator } = task;
    expect(TeammateTaskSchema.safeParse(withoutCreator).success).toBe(false);
    expect(TeammateTaskSchema.parse({ ...task, createdByTeammateId: 'creator-1' }).createdByTeammateId).toBe('creator-1');
    const response = { task, issueUrl: 'https://github.com/owner/repo/issues/12', created: true };
    expect(TeammateTaskCreateResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts review metadata and requires a summary for verdicts', () => {
    expect(TeammateTaskSchema.parse({ ...task, reviewerTeammateId: 'reviewer-1', parentTaskId: 'impl-1', reviewRound: 2 })).toMatchObject({
      reviewerTeammateId: 'reviewer-1', parentTaskId: 'impl-1', reviewRound: 2,
    });
    const baseUpdate = { runId: 'run-1', dispatchToken: 'token-1' };
    expect(TeammateTaskAgentUpdateRequestSchema.parse({ ...baseUpdate, verdict: 'approved', summary: 'Looks good' })).toMatchObject({ verdict: 'approved' });
    expect(TeammateTaskAgentUpdateRequestSchema.safeParse({ ...baseUpdate, verdict: 'changes_requested' }).success).toBe(false);
    expect(TeammateTaskAgentUpdateRequestSchema.safeParse({ ...baseUpdate, verdict: 'changes_requested', summary: '   ' }).success).toBe(false);
  });

  it('parses task details with controller and worker sessions', () => {
    const sessions = [
      { sessionId: 'controller-1', role: 'controller', createdAt: 1791417600000 },
      { sessionId: 'worker-1', role: 'worker', createdAt: 1791417660000 },
    ];
    for (const session of sessions) {
      expect(TeammateTaskSessionSchema.parse(session)).toEqual(session);
    }
    const detail = { task, sessions, runs: [] };
    expect(TeammateTaskDetailSchema.parse(detail)).toEqual(detail);
  });

  const taskDispatchPayload: TeammateRunDispatchPayload = {
    runId: 'run-1',
    dispatchToken: 'dispatch-token-1',
    attempt: 1,
    teammate: {
      id: 'teammate-1',
      handle: 'atlas',
      name: 'Atlas',
      avatar: { emoji: '🤖', color: '#2563eb', imageUrl: 'https://example.com/atlas.png' },
      role: 'Backend engineer',
      skills: ['typescript', 'fastify'],
      repos: ['happy-next/happy-next'],
      instructions: 'Open a draft PR and ask for review when tests pass.',
      machineId: 'machine-1',
      controllerProvider: 'claude',
      controllerModel: null,
      controllerPermissionMode: 'default',
      controllerProfileId: null,
      controllerEnv: null,
      workerProvider: 'claude',
      model: null,
      workerPermissionMode: 'acceptEdits',
      workerProfileId: null,
      workerEnv: null,
      maxConcurrentRuns: 3,
      monthlyBudgetUsd: 100,
      timezone: null,
      heartbeatIntervalMin: 30,
      activeHours: { start: '09:00', end: '18:00', timezone: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] },
      dreamingHour: 22,
      canSelfAssign: false,
      status: 'active',
      createdAt: 1791417600000,
      updatedAt: 1791417660000,
    },
    thread: {
      id: 'thread-1',
      kind: 'task',
      channelId: null,
      taskId: 'task-1',
      providerSessionId: 'provider-session-1',
      currentSessionId: null,
      resetAt: null,
    },
    channel: null,
    task: null,
    trigger: 'task-assigned',
    events: [
      { type: 'task-assigned', at: 1791417720000, data: { taskId: 'task-1', note: 'Fix issue #123' } },
      {
        type: 'channel-message',
        at: 1791417780000,
        data: {
          channelId: 'channel-1', messageId: 'message-1', seq: 42,
          context: { resourceId: 'happy-next/happy-next#123', urgent: true },
        },
      },
    ],
  };

  it('keeps the read schema lenient for legacy free-text skills', () => {
    const parsed = TeammateSchema.parse({
      ...taskDispatchPayload.teammate,
      skills: ['some free text'],
    });
    expect(parsed.skills).toEqual(['some free text']);
  });

  it('allows Gemini work sessions but only Claude Code or Codex as the main session', () => {
    const base = { handle: 'atlas', name: 'Atlas', machineId: 'machine-1' };
    expect(TeammateCreateRequestSchema.parse({ ...base, controllerProvider: 'codex', workerProvider: 'gemini' }).controllerProvider).toBe('codex');
    expect(TeammateCreateRequestSchema.safeParse({ ...base, controllerProvider: 'gemini' }).success).toBe(false);
    expect(TeammateUpdateRequestSchema.safeParse({ controllerProvider: 'gemini' }).success).toBe(false);
  });

  it('requires a nullable teammate timezone and validates create and update bounds', () => {
    const teammate = taskDispatchPayload.teammate;
    const { timezone, ...withoutTimezone } = teammate;
    expect(TeammateRunDispatchPayloadSchema.safeParse({ ...taskDispatchPayload, teammate: withoutTimezone }).success).toBe(false);
    expect(TeammateCreateRequestSchema.parse({ handle: 'atlas', name: 'Atlas', machineId: 'machine-1', timezone: null }).timezone).toBeNull();
    expect(TeammateUpdateRequestSchema.parse({ timezone: 'Asia/Shanghai' })).toEqual({ timezone: 'Asia/Shanghai' });
    expect(TeammateCreateRequestSchema.safeParse({ handle: 'atlas', name: 'Atlas', machineId: 'machine-1', timezone: '' }).success).toBe(false);
    expect(TeammateUpdateRequestSchema.safeParse({ timezone: 'x'.repeat(65) }).success).toBe(false);
  });

  it('parses scheduled run responses', () => {
    const run = {
      id: 'run-1', teammateId: 'teammate-1', threadId: 'thread-1', threadKind: 'heartbeat',
      trigger: 'heartbeat', status: 'completed', attempt: 1, failureReason: null,
      sessionId: null, taskId: null, costUsd: null, queuedAt: 1, startedAt: null, finishedAt: 2,
    };
    expect(TeammateScheduledRunResponseSchema.parse({ run })).toEqual({ run });
  });

  it('parses a task dispatch with a profile snapshot and coalesced events', () => {
    const payload: TeammateRunDispatchPayload = { ...taskDispatchPayload, task };
    expect(TeammateRunDispatchPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('parses a dispatch with task set to null', () => {
    expect(TeammateRunDispatchPayloadSchema.parse(taskDispatchPayload)).toEqual(taskDispatchPayload);
  });

  it.each(['dm', 'group'] as const)('parses a %s dispatch with a channel and context reset', (kind) => {
    const payload: TeammateRunDispatchPayload = {
      ...taskDispatchPayload,
      thread: { ...taskDispatchPayload.thread, kind, channelId: 'channel-1', taskId: null, resetAt: 1791417800000 },
      channel: {
        id: 'channel-1',
        kind,
        title: kind === 'group' ? 'Engineering' : null,
        teammateEncryptedDataKey: 'teammate-key',
        members: [
          { memberType: 'user', id: 'account-1', name: 'You', handle: null },
          { memberType: 'teammate', id: 'teammate-1', name: 'Atlas', handle: 'atlas' },
        ],
      },
      trigger: 'channel-message',
      events: [{ type: 'channel-message', at: 1791417780000, data: { channelId: 'channel-1', messageId: 'message-1', seq: 42 } }],
    };

    expect(TeammateRunDispatchPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('requires the nullable task, channel and thread resetAt fields in dispatches', () => {
    const { task, ...withoutTask } = taskDispatchPayload;
    expect(TeammateRunDispatchPayloadSchema.safeParse(withoutTask).success).toBe(false);
    const { channel, ...withoutChannel } = taskDispatchPayload;
    expect(TeammateRunDispatchPayloadSchema.safeParse(withoutChannel).success).toBe(false);
    const { resetAt, ...withoutResetAt } = taskDispatchPayload.thread;
    expect(TeammateRunDispatchPayloadSchema.safeParse({
      ...taskDispatchPayload, thread: withoutResetAt,
    }).success).toBe(false);
  });
});
