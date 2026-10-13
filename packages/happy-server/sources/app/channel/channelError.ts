/** Channel domain failures mapped to account-authenticated REST errors. */
export class ChannelError extends Error {
    constructor(public readonly code: 'not_found' | 'invalid_request' | 'invalid_sender' | 'invalid_token' | 'run_expired' | 'archived' | 'not_group' | 'full' | 'last_member') {
        super(code);
        this.name = 'ChannelError';
    }
}
