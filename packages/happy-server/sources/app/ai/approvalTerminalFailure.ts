export function isApprovalTerminalFailure(errorCode: string | null | undefined): boolean {
    return errorCode === 'APPROVAL_SESSION_INTERRUPTED'
        || errorCode === 'APPROVAL_OUTCOME_UNCERTAIN';
}
