import axios from 'axios';

const HINTS: Record<string, string> = {
    github_not_connected: "The owner's account has no GitHub connection, so GitHub-backed tools cannot run. Tell the owner to connect GitHub; retrying will not help.",
    already_delegated: 'Another Agent already has an open task for this issue or PR. Do not create a duplicate.',
    repo_not_allowed: "This repo is not in your authorized repos. Propose the work to the owner with chat_send(kind=decision).",
    self_assign_disabled: 'Self-assignment is disabled for you. Propose the work to the owner with chat_send(kind=decision).',
    issue_not_found: 'The issue or pull request does not exist or is closed.',
    task_create_limit: 'Daily limit for creating new issues reached (the owner was notified). Delegating existing issues or PRs is not limited; otherwise retry tomorrow.',
    task_inactive: 'This task is no longer active.',
    run_expired: 'This run has expired; wait for the next dispatch.',
    invalid_token: 'The run dispatch token is invalid; wait for the next dispatch.',
    archived: 'The target Agent is archived.',
    not_found: 'The target (Agent handle, issue or resource) was not found.',
    no_dm: 'There is no DM channel with this Agent.',
};

/** Turns Happy server REST failures ({ error: code }) into a message that keeps the code and explains it, instead of axios' bare "status code 409". */
export function describeServerError(error: unknown): Error {
    if (!axios.isAxiosError(error) || !error.response) return error instanceof Error ? error : new Error(String(error));
    const { status, data } = error.response;
    const code = typeof data?.error === 'string' ? data.error : undefined;
    if (!code) return error;
    const hint = HINTS[code];
    return new Error(`Server rejected the request (HTTP ${status}, ${code})${hint ? `: ${hint}` : ''}`);
}
