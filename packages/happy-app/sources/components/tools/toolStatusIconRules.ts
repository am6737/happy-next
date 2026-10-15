import { ToolCall } from '@/sync/typesMessage';

type ShouldShowOrchestratorSubmitActivityIndicatorArgs = {
    toolName: string;
    toolState: ToolCall['state'];
    hasSessionId: boolean;
    noStatus: boolean;
    isMatchingOrchestratorSubmitRunId: boolean;
};

export function shouldShowOrchestratorSubmitActivityIndicator(
    args: ShouldShowOrchestratorSubmitActivityIndicatorArgs,
): boolean {
    return (
        // orchestrator_exec and orchestrator_transfer start a run as well, which goes on when the
        // call stops waiting for it
        /orchestrator_submit|orchestrator_exec|orchestrator_transfer/.test(args.toolName) &&
        args.toolState === 'completed' &&
        args.hasSessionId &&
        args.isMatchingOrchestratorSubmitRunId &&
        !args.noStatus
    );
}
