import { z } from 'zod';
import { TEAMMATE_ENV, TEAMMATE_TASK_AGENT_STATUSES } from 'happy-wire';
import { REPO_PATTERN } from './workspace';

export const TeammateToolSchemas = {
    'work-session-start': z.object({
        repo: z.string().regex(REPO_PATTERN), prompt: z.string().min(1), title: z.string().min(1).optional(),
        baseBranch: z.string().min(1).optional(), continueFrom: z.string().min(1).optional(),
    }),
    'work-session-send': z.object({ sessionId: z.string().min(1), text: z.string().min(1) }),
    'work-session-read': z.object({ sessionId: z.string().min(1), limit: z.number().int().min(1).max(200).default(40) }),
    'work-session-list': z.object({}),
    'work-session-stop': z.object({ sessionId: z.string().min(1) }),
    'task-update': z.object({
        status: z.enum(TEAMMATE_TASK_AGENT_STATUSES).optional(),
        summary: z.string().max(4000).optional(),
        prUrl: z.string().url().optional(),
        verdict: z.enum(['approved', 'changes_requested']).describe('Review tasks only: approve a mergeable PR or request blocking changes. A summary is required.').optional(),
    }).superRefine((value, context) => {
        if (value.status === undefined && value.summary === undefined && value.prUrl === undefined && value.verdict === undefined) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'Supply status, summary, prUrl or verdict' });
        }
        if (value.verdict !== undefined && (!value.summary || !value.summary.trim())) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ['summary'], message: 'summary is required when verdict is present' });
        }
    }),
    'task-comment': z.object({ body: z.string().min(1).max(60000) }),
    'memory-note': z.object({ text: z.string().min(1).max(20000) }),
    'task-create': z.object({ repo: z.string().regex(REPO_PATTERN), issueNumber: z.number().int().positive().optional().describe('Issue or pull request number; use a PR number to assign a PR review.'), title: z.string().min(1).max(256).optional(), body: z.string().max(20000).optional(), assignee: z.string().min(1).describe('Name of the Agent to delegate to; defaults to you.').optional(), reviewer: z.string().min(1).describe('Name of the Agent who should automatically review the PR once the assignee marks the implementation task in_review.').optional() }),
    'memory-commit': z.object({ message: z.string().min(1).max(200) }),
};
export type TeammateToolPath = keyof typeof TeammateToolSchemas;
export const TeammateToolDescriptions: Record<TeammateToolPath, string> = {
    'work-session-start': 'Delegate implementation to a worker in an isolated git worktree. Give a self-contained prompt with the requirements, files to change and checks to run (the worker loads the repo instruction files itself), ask for an early draft PR signed with your Happy Agent signature, then end your turn: you are woken when the worker finishes. continueFrom reuses a worker session worktree and resumes Claude when possible.',
    'work-session-send': 'Send a follow-up to a live worker belonging to this task. For an ended worker, restart with work_session_start(continueFrom=sessionId).',
    'work-session-read': 'Read a compact decrypted worker transcript, oldest first. Tool results are omitted; assistant blocks and total output are capped. status is running while the worker is still working: end your turn instead of polling, you are woken when it finishes. When idle, result holds the final reply, the worker happy-result report and git/PR facts the daemon checked itself.',
    'work-session-list': 'List all workers of this task, including worktree, branch and whether their process is alive.',
    'work-session-stop': 'Stop one worker of this task, keeping its worktree and provider session for continueFrom.',
    'task-update': 'Update task status, summary, PR URL or a review verdict; supply at least one field. verdict is for review tasks only: use approved when the PR can be merged, or changes_requested when blocking changes are required, and list them in the summary. On completion set in_review or done with prUrl and a summary; send a chat_send report only for tasks the owner assigned directly (for tasks assigned by another agent, that agent reports). done stops workers.',
    'task-comment': 'Post an issue comment through the server using the owner GitHub access. The server appends your Happy Agent signature.',
    'memory-note': 'Append a learning to today local memory log, with the current run and controller session as its source.',
    'task-create': 'Create or take an issue or pull request in an authorized repository and delegate it to an Agent. issueNumber may be an issue number or a pull request number; use a PR number to assign a PR review. assignee and reviewer are Agent names. reviewer is the Agent that should automatically review the PR after the assignee marks the implementation task in_review. If self-assignment is disabled, propose the work through chat_send(kind=decision).',
    'memory-commit': 'Commit pending changes in the Agent home repository with a one-line summary.',
};

/** Return the raw shape used by MCP even for schemas with runtime refinements. */
export function teammateToolShape(path: TeammateToolPath): z.ZodRawShape {
    const schema = TeammateToolSchemas[path];
    return schema instanceof z.ZodObject ? schema.shape : (schema as z.ZodEffects<z.AnyZodObject>).innerType().shape;
}

/** One availability policy for MCP registration and Claude's allowed-tool names. */
export function teammateToolNames(env: NodeJS.ProcessEnv = process.env): string[] {
    if (!env[TEAMMATE_ENV.threadId] || env[TEAMMATE_ENV.sessionRole] !== 'controller') return [];
    return ['chat_send', 'chat_history', ...Object.keys(TeammateToolSchemas)
        .filter(path => ['memory-note', 'task-create', 'memory-commit'].includes(path) || Boolean(env[TEAMMATE_ENV.taskId]))
        .map(path => path.replace(/-/g, '_'))];
}
