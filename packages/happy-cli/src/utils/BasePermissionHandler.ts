/**
 * Base Permission Handler
 *
 * Abstract base class for permission handlers that manage tool approval requests.
 * Shared by Codex and Gemini permission handlers.
 *
 * @module BasePermissionHandler
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { AgentState, PermissionMode } from "@/api/types";
import { PushNotificationClient } from "@/api/pushNotifications";
import { SHELL_TOOLS, addBashRules, isBashCommandAllowed, shellCommandOf } from "happy-wire";

/**
 * Permission response from the mobile app.
 */
export interface PermissionResponse {
    id: string;
    approved: boolean;
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    answers?: Record<string, string>;
    /**
     * Tools the user stopped being asked about ("don't ask again"). The agent's own "always allow"
     * applies them, except `Bash(...)` rules for a shell command, which the handler keeps itself.
     */
    allowTools?: string[];
    /** Mode the app switched the session to with this answer ("allow all edits") — kept so the app can show which button was used */
    mode?: PermissionMode;
    /** Codex: the proposed command prefix the user allowed from now on */
    execpolicyAmendment?: string[];
}

/**
 * Pending permission request stored while awaiting user response.
 */
export interface PendingRequest {
    resolve: (value: PermissionResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: unknown;
}

/**
 * Result of a permission request.
 */
export interface PermissionResult {
    decision: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    answers?: Record<string, string>;
    /** Mode the app switched the session to with this answer */
    mode?: PermissionMode;
    /** Codex: the proposed command prefix the user allowed from now on */
    execpolicyAmendment?: string[];
}

/**
 * Abstract base class for permission handlers.
 *
 * Subclasses must implement:
 * - `getLogPrefix()` - returns the log prefix (e.g., '[Codex]')
 */
export abstract class BasePermissionHandler {
    protected pendingRequests = new Map<string, PendingRequest>();
    protected session: ApiSessionClient;
    protected pushClient: PushNotificationClient;
    private isResetting = false;
    /** Shell commands "don't ask again" covers, checked by the handlers that ask for shell tools */
    private readonly allowedShellLiterals = new Set<string>();
    private readonly allowedShellPrefixes = new Set<string>();

    /**
     * Returns the log prefix for this handler.
     */
    protected abstract getLogPrefix(): string;

    /**
     * Returns the agent name used in push notification text (e.g. "Codex", "Gemini").
     */
    protected abstract getAgentName(): string;

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        this.session = session;
        this.pushClient = pushClient;
        this.setupRpcHandler();
    }

    /**
     * Update the session reference (used after offline reconnection swaps sessions).
     * This is critical for avoiding stale session references after onSessionSwap.
     */
    updateSession(newSession: ApiSessionClient): void {
        logger.debug(`${this.getLogPrefix()} Session reference updated`);
        this.session = newSession;
        // Re-setup RPC handler with new session
        this.setupRpcHandler();
    }

    /**
     * Setup RPC handler for permission responses.
     */
    protected setupRpcHandler(): void {
        this.session.rpcHandlerManager.registerHandler<PermissionResponse, void>(
            'permission',
            async (response) => {
                const pending = this.pendingRequests.get(response.id);
                if (!pending) {
                    logger.debug(`${this.getLogPrefix()} Permission request not found or already resolved`);
                    return;
                }

                // Remove from pending
                this.pendingRequests.delete(response.id);

                // Rules the user picked for a shell command are kept here rather than given to the agent,
                // whose own "always allow" saves a rule of its choosing (often the whole command line)
                const shellRules = SHELL_TOOLS.has(pending.toolName) ? response.allowTools?.filter((rule) => rule.startsWith('Bash(')) ?? [] : [];
                addBashRules(shellRules, this.allowedShellLiterals, this.allowedShellPrefixes);
                if (shellRules.length) this.persistShellRules(shellRules);
                const forSession = !shellRules.length && (response.decision === 'approved_for_session' || !!response.allowTools?.length);

                // Resolve the permission request
                const result: PermissionResult = response.approved
                    ? {
                        decision: forSession ? 'approved_for_session' : 'approved',
                        ...(response.answers ? { answers: response.answers } : {}),
                        ...(response.mode ? { mode: response.mode } : {}),
                        ...(response.execpolicyAmendment?.length ? { execpolicyAmendment: response.execpolicyAmendment } : {})
                    }
                    : { decision: response.decision === 'denied' ? 'denied' : 'abort' };

                pending.resolve(result);

                // Move request to completed in agent state
                this.session.updateAgentState((currentState) => {
                    const request = currentState.requests?.[response.id];
                    if (!request) return currentState;

                    const { [response.id]: _, ...remainingRequests } = currentState.requests || {};

                    let res = {
                        ...currentState,
                        requests: remainingRequests,
                        completedRequests: {
                            ...currentState.completedRequests,
                            [response.id]: {
                                tool: request.tool,
                                createdAt: request.createdAt,
                                completedAt: Date.now(),
                                status: response.approved ? 'approved' : 'denied',
                                decision: result.decision,
                                ...(response.mode ? { mode: response.mode } : {}),
                                ...(response.allowTools?.length ? { allowedTools: response.allowTools } : {})
                            }
                        }
                    } satisfies AgentState;
                    return res;
                });

                logger.debug(`${this.getLogPrefix()} Permission ${response.approved ? 'approved' : 'denied'} for ${pending.toolName}`);
            }
        );
    }

    /** Saves shell rules where the agent finds them on its next start; by default they last as long as the handler. */
    protected persistShellRules(_rules: string[]): void {}

    /** Whether "don't ask again" already covers this shell command, so it can run without asking */
    protected isShellCommandAllowed(toolName: string, input: unknown): boolean {
        const command = SHELL_TOOLS.has(toolName) ? shellCommandOf(input) : null;
        return !!command && isBashCommandAllowed(command, this.allowedShellLiterals, this.allowedShellPrefixes);
    }

    /**
     * Add a pending request to the agent state and send a push notification.
     */
    protected addPendingRequestToState(toolCallId: string, toolName: string, input: unknown): void {
        // Send push notification to mobile app
        this.pushClient.sendToAllDevices(
            'Permission Request',
            `${this.getAgentName()} wants to ${toolName}`,
            {
                sessionId: this.session.sessionId,
                requestId: toolCallId,
                tool: toolName,
                type: 'permission_request'
            }
        );

        this.session.updateAgentState((currentState) => ({
            ...currentState,
            requests: {
                ...currentState.requests,
                [toolCallId]: {
                    tool: toolName,
                    arguments: input,
                    createdAt: Date.now()
                }
            }
        }));
    }

    /**
     * Reset state for new sessions.
     * This method is idempotent - safe to call multiple times.
     */
    reset(): void {
        // Guard against re-entrant/concurrent resets
        if (this.isResetting) {
            logger.debug(`${this.getLogPrefix()} Reset already in progress, skipping`);
            return;
        }
        this.isResetting = true;

        try {
            // Snapshot pending requests to avoid Map mutation during iteration
            const pendingSnapshot = Array.from(this.pendingRequests.entries());
            this.pendingRequests.clear(); // Clear immediately to prevent new entries being processed

            // Reject all pending requests from snapshot
            for (const [id, pending] of pendingSnapshot) {
                try {
                    pending.reject(new Error('Session reset'));
                } catch (err) {
                    logger.debug(`${this.getLogPrefix()} Error rejecting pending request ${id}:`, err);
                }
            }

            // Clear requests in agent state
            this.session.updateAgentState((currentState) => {
                const pendingRequests = currentState.requests || {};
                const completedRequests = { ...currentState.completedRequests };

                // Move all pending to completed as canceled
                for (const [id, request] of Object.entries(pendingRequests)) {
                    completedRequests[id] = {
                        tool: request.tool,
                        createdAt: request.createdAt,
                        completedAt: Date.now(),
                        status: 'canceled',
                        reason: 'Session reset'
                    };
                }

                return {
                    ...currentState,
                    requests: {},
                    completedRequests
                };
            });

            logger.debug(`${this.getLogPrefix()} Permission handler reset`);
        } finally {
            this.isResetting = false;
        }
    }
}
