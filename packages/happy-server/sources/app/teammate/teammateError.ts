/** Domain errors exposed by the identity and runtime REST contracts. */
export class TeammateError extends Error {
    constructor(public readonly code: 'not_found' | 'machine_not_found' | 'handle_taken' | 'archived' | 'invalid_token' | 'run_expired' | 'already_delegated' | 'task_inactive' | 'no_dm' | 'github_not_connected' | 'invalid_request' | 'invalid_timezone' | 'self_assign_disabled' | 'repo_not_allowed' | 'issue_not_found' | 'task_create_limit') {
        super(code);
        this.name = 'TeammateError';
    }
}
