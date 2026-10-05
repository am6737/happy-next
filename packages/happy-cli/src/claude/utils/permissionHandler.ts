/**
 * Permission Handler for canCallTool integration
 * 
 * Replaces the MCP permission server with direct SDK integration.
 * Handles tool permission requests, responses, and state management.
 */

import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from "@/lib";
import { SDKAssistantMessage, SDKMessage, SDKUserMessage } from "../sdk";
import { PermissionResult } from "../sdk/types";
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from "../sdk/prompts";
import { Session } from "../session";
import { getToolName } from "./getToolName";
import { EnhancedMode, PermissionMode } from "../loop";
import { getToolDescriptor } from "./getToolDescriptor";
import { delay } from "@/utils/time";

interface PermissionResponse {
    id: string;
    approved: boolean;
    reason?: string;
    mode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';
    allowTools?: string[];
    answers?: Record<string, string>;
    receivedAt?: number;
}


// Happy's own MCP UI tools: renaming the chat, and showing a preview inside the app. The
// app is the one issuing them, and it renders `change_title` as an event message rather
// than a tool row, so a pending permission for it has no footer to approve it from - the
// turn hangs with the session stuck on "needs permission". Neither touches the user's
// machine: one writes the app's own title, the other hands the app a document to render.
// Both are therefore exempt in every mode, plan included, which is also what Gemini and
// Codex have always done; Claude was the only handler missing it.
//
// An exact list on purpose, not an `mcp__happy__` prefix: the orchestrator tools share that
// prefix, and they spawn and drive real agent work that must keep asking.
const HAPPY_UI_TOOLS: ReadonlySet<string> = new Set([
    'mcp__happy__change_title',
    'mcp__happy__preview_html',
]);

interface PendingRequest {
    resolve: (value: PermissionResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: unknown;
}

/**
 * Whether a tool that already reached our permission callback may be
 * auto-approved purely from the permission mode (i.e. without asking the user).
 *
 * Note bypassPermissions deliberately does NOT auto-approve here. The Claude CLI
 * auto-approves everything it can on its own and only routes to this callback the
 * tools it refuses to decide — verified empirically: under bypassPermissions it
 * runs Write without consulting us, but still delegates AskUserQuestion and
 * ExitPlanMode. So anything that reaches us under bypassPermissions is a
 * user-interaction the user must resolve; we fail safe by asking rather than
 * maintaining a hand-kept allow-list that silently approves any future
 * interaction tool the CLI adds.
 */
export function canAutoApproveForMode(mode: PermissionMode, descriptor: { edit?: boolean }): boolean {
    return mode === 'acceptEdits' && Boolean(descriptor.edit);
}

/**
 * The whole auto-approval policy for a tool that has reached our permission callback:
 * Happy's own UI tools never ask, in any mode, and an edit asks only outside acceptEdits.
 * Everything else falls through to the user.
 */
export function canAutoApproveTool(toolName: string, mode: PermissionMode, descriptor: { edit?: boolean }): boolean {
    return HAPPY_UI_TOOLS.has(toolName) || canAutoApproveForMode(mode, descriptor);
}

export class PermissionHandler {
    private toolCalls: { id: string, name: string, input: any, used: boolean }[] = [];
    private responses = new Map<string, PermissionResponse>();
    private pendingRequests = new Map<string, PendingRequest>();
    private session: Session;
    private allowedTools = new Set<string>();
    private allowedBashLiterals = new Set<string>();
    private allowedBashPrefixes = new Set<string>();
    private permissionMode: PermissionMode = 'default';
    private lastNonPlanPermissionMode: Exclude<PermissionMode, 'plan'> = 'default';
    private onPermissionRequestCallback?: (toolCallId: string) => void;
    private modeForwarder?: (mode: PermissionMode) => Promise<void>;

    constructor(session: Session) {
        this.session = session;
        this.setupClientHandler();
    }

    /**
     * Set callback to trigger when permission request is made
     */
    setOnPermissionRequest(callback: (toolCallId: string) => void) {
        this.onPermissionRequestCallback = callback;
    }

    setModeForwarder(forwarder?: (mode: PermissionMode) => Promise<void>) {
        this.modeForwarder = forwarder;
    }

    handleModeChange(mode: PermissionMode) {
        this.permissionMode = mode;
        if (mode !== 'plan') {
            this.lastNonPlanPermissionMode = mode;
        }
        // Keep the subprocess's toolPermissionContext in sync, otherwise tools
        // the CLI auto-decides (e.g. Write under bypassPermissions) use stale mode.
        this.modeForwarder?.(mode).catch((err) => {
            logger.debug(`[permissionHandler] set_permission_mode forward failed: ${err}`);
        });
    }

    private getResumeModeAfterPlan(responseMode?: PermissionResponse['mode']): Exclude<PermissionMode, 'plan'> {
        if (responseMode && responseMode !== 'plan') {
            return responseMode;
        }
        if (this.permissionMode !== 'plan') {
            return this.permissionMode;
        }
        return this.lastNonPlanPermissionMode;
    }

    /**
     * Handler response
     */
    private handlePermissionResponse(
        response: PermissionResponse,
        pending: PendingRequest
    ): void {

        // Update allowed tools (in-memory for current session)
        if (response.allowTools && response.allowTools.length > 0) {
            response.allowTools.forEach(tool => {
                if (tool.startsWith('Bash(') || tool === 'Bash') {
                    this.parseBashPermission(tool);
                } else {
                    this.allowedTools.add(tool);
                }
            });

            // Persist to .claude/settings.local.json for cross-session permanence
            this.persistAllowedTools(response.allowTools);
        }

        // Update permission mode
        if (response.mode) {
            this.permissionMode = response.mode;
            if (response.mode !== 'plan') {
                this.lastNonPlanPermissionMode = response.mode;
            }
        }

        // Handle 
        if (pending.toolName === 'exit_plan_mode' || pending.toolName === 'ExitPlanMode') {
            // Handle exit_plan_mode specially
            logger.debug('Plan mode result received', response);
            if (response.approved) {
                logger.debug('Plan approved - injecting PLAN_FAKE_RESTART');
                // Inject the approval message at the beginning of the queue
                const resumeMode = this.getResumeModeAfterPlan(response.mode);
                this.session.queue.unshift(PLAN_FAKE_RESTART, { permissionMode: resumeMode });
                pending.resolve({ behavior: 'deny', message: PLAN_FAKE_REJECT });
            } else {
                pending.resolve({ behavior: 'deny', message: response.reason || 'Plan rejected' });
            }
        } else {
            // Handle default case for all other tools
            let updatedInput = (pending.input as Record<string, unknown>) || {};

            // For AskUserQuestion, merge user answers into updatedInput
            if (pending.toolName === 'AskUserQuestion' && response.answers) {
                updatedInput = { ...updatedInput, answers: response.answers };
            }

            const result: PermissionResult = response.approved
                ? { behavior: 'allow', updatedInput }
                : { behavior: 'deny', message: response.reason || `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.` };

            pending.resolve(result);
        }
    }

    /**
     * Creates the canCallTool callback for the SDK
     */
    handleToolCall = async (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal }): Promise<PermissionResult> => {

        // Check if tool is explicitly allowed
        if (toolName === 'Bash') {
            const inputObj = input as { command?: string };
            if (inputObj?.command) {
                // Check literal matches
                if (this.allowedBashLiterals.has(inputObj.command)) {
                    return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
                }
                // Check prefix matches
                for (const prefix of this.allowedBashPrefixes) {
                    if (inputObj.command.startsWith(prefix)) {
                        return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
                    }
                }
            }
        } else if (this.allowedTools.has(toolName)) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
        }

        // Calculate descriptor
        const descriptor = getToolDescriptor(toolName);

        //
        // Auto-approval: Happy's own UI tools in any mode, edits under acceptEdits
        //

        if (canAutoApproveTool(toolName, this.permissionMode, descriptor)) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
        }

        //
        // Approval flow
        //

        let toolCallId = this.resolveToolCallId(toolName, input);
        if (!toolCallId) { // What if we got permission before tool call
            await delay(1000);
            toolCallId = this.resolveToolCallId(toolName, input);
            if (!toolCallId) {
                throw new Error(`Could not resolve tool call ID for ${toolName}`);
            }
        }
        return this.handlePermissionRequest(toolCallId, toolName, input, options.signal);
    }

    /**
     * Handles individual permission requests
     */
    private async handlePermissionRequest(
        id: string,
        toolName: string,
        input: unknown,
        signal: AbortSignal
    ): Promise<PermissionResult> {
        return new Promise<PermissionResult>((resolve, reject) => {
            // Set up abort signal handling
            const abortHandler = () => {
                this.pendingRequests.delete(id);
                reject(new Error('Permission request aborted'));
            };
            signal.addEventListener('abort', abortHandler, { once: true });

            // Store the pending request
            this.pendingRequests.set(id, {
                resolve: (result: PermissionResult) => {
                    signal.removeEventListener('abort', abortHandler);
                    resolve(result);
                },
                reject: (error: Error) => {
                    signal.removeEventListener('abort', abortHandler);
                    reject(error);
                },
                toolName,
                input
            });

            // Trigger callback to send delayed messages immediately
            if (this.onPermissionRequestCallback) {
                this.onPermissionRequestCallback(id);
            }
            
            // Send push notification
            this.session.api.push().sendToAllDevices(
                'Permission Request',
                `Claude wants to ${getToolName(toolName)}`,
                {
                    sessionId: this.session.client.sessionId,
                    requestId: id,
                    tool: toolName,
                    type: 'permission_request'
                }
            );

            // Update agent state
            this.session.client.updateAgentState((currentState) => ({
                ...currentState,
                requests: {
                    ...currentState.requests,
                    [id]: {
                        tool: toolName,
                        arguments: input,
                        createdAt: Date.now()
                    }
                }
            }));

            logger.debug(`Permission request sent for tool call ${id}: ${toolName}`);
        });
    }


    /**
     * Persists allowed tools to .claude/settings.local.json so they survive across sessions.
     * This matches Claude Code CLI's native behavior for "Allow always".
     */
    private async persistAllowedTools(tools: string[]): Promise<void> {
        try {
            const settingsDir = join(this.session.path, '.claude');
            const settingsPath = join(settingsDir, 'settings.local.json');

            // Read existing settings
            let settings: any = {};
            try {
                const content = await readFile(settingsPath, 'utf-8');
                settings = JSON.parse(content);
            } catch {
                // File doesn't exist or is invalid JSON, start fresh
            }

            // Ensure permissions.allow array exists
            if (!settings.permissions) {
                settings.permissions = {};
            }
            if (!Array.isArray(settings.permissions.allow)) {
                settings.permissions.allow = [];
            }

            // Add new tools (avoid duplicates)
            let changed = false;
            for (const tool of tools) {
                if (!settings.permissions.allow.includes(tool)) {
                    settings.permissions.allow.push(tool);
                    changed = true;
                }
            }

            if (changed) {
                await mkdir(settingsDir, { recursive: true });
                await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
                logger.debug(`Persisted allowed tools to ${settingsPath}: ${tools.join(', ')}`);
            }
        } catch (error) {
            logger.debug(`Failed to persist allowed tools: ${error}`);
        }
    }

    /**
     * Parses Bash permission strings into literal and prefix sets
     */
    private parseBashPermission(permission: string): void {
        // Ignore plain "Bash"
        if (permission === 'Bash') {
            return;
        }

        // Match Bash(command) or Bash(command:*)
        const bashPattern = /^Bash\((.+?)\)$/;
        const match = permission.match(bashPattern);
        
        if (!match) {
            return;
        }

        const command = match[1];
        
        // Check if it's a prefix pattern (ends with :*)
        if (command.endsWith(':*')) {
            const prefix = command.slice(0, -2); // Remove :*
            this.allowedBashPrefixes.add(prefix);
        } else {
            // Literal match
            this.allowedBashLiterals.add(command);
        }
    }

    /**
     * Resolves tool call ID based on tool name and input
     */
    private resolveToolCallId(name: string, args: any): string | null {
        // Search in reverse (most recent first)
        for (let i = this.toolCalls.length - 1; i >= 0; i--) {
            const call = this.toolCalls[i];
            if (call.name === name && isDeepStrictEqual(call.input, args)) {
                if (call.used) {
                    return null;
                }
                // Found unused match - mark as used and return
                call.used = true;
                return call.id;
            }
        }

        return null;
    }

    /**
     * Handles messages to track tool calls
     */
    onMessage(message: SDKMessage): void {
        if (message.type === 'assistant') {
            const assistantMsg = message as SDKAssistantMessage;
            if (assistantMsg.message && assistantMsg.message.content) {
                for (const block of assistantMsg.message.content) {
                    if (block.type === 'tool_use') {
                        this.toolCalls.push({
                            id: block.id!,
                            name: block.name!,
                            input: block.input,
                            used: false
                        });
                    }
                }
            }
        }
        if (message.type === 'user') {
            const userMsg = message as SDKUserMessage;
            if (userMsg.message && userMsg.message.content && Array.isArray(userMsg.message.content)) {
                for (const block of userMsg.message.content) {
                    if (block.type === 'tool_result' && block.tool_use_id) {
                        const toolCall = this.toolCalls.find(tc => tc.id === block.tool_use_id);
                        if (toolCall && !toolCall.used) {
                            toolCall.used = true;
                        }
                    }
                }
            }
        }
    }

    /**
     * Checks if a tool call is rejected
     */
    isAborted(toolCallId: string): boolean {

        // If tool not approved, it's aborted
        if (this.responses.get(toolCallId)?.approved === false) {
            return true;
        }

        // Always abort exit_plan_mode
        const toolCall = this.toolCalls.find(tc => tc.id === toolCallId);
        if (toolCall && (toolCall.name === 'exit_plan_mode' || toolCall.name === 'ExitPlanMode')) {
            return true;
        }

        // Tool call is not aborted
        return false;
    }

    /**
     * Resets all state for new sessions
     */
    reset(): void {
        this.toolCalls = [];
        this.responses.clear();
        this.allowedTools.clear();
        this.allowedBashLiterals.clear();
        this.allowedBashPrefixes.clear();
        this.permissionMode = 'default';
        this.lastNonPlanPermissionMode = 'default';

        // Cancel all pending requests
        for (const [, pending] of this.pendingRequests.entries()) {
            pending.reject(new Error('Session reset'));
        }
        this.pendingRequests.clear();

        // Move all pending requests to completedRequests with canceled status
        this.session.client.updateAgentState((currentState) => {
            const pendingRequests = currentState.requests || {};
            const completedRequests = { ...currentState.completedRequests };

            // Move each pending request to completed with canceled status
            for (const [id, request] of Object.entries(pendingRequests)) {
                completedRequests[id] = {
                    ...request,
                    completedAt: Date.now(),
                    status: 'canceled',
                    reason: 'Session switched to local mode'
                };
            }

            return {
                ...currentState,
                requests: {}, // Clear all pending requests
                completedRequests
            };
        });
    }

    /**
     * Sets up the client handler for permission responses
     */
    private setupClientHandler(): void {
        this.session.client.rpcHandlerManager.registerHandler<PermissionResponse, void>('permission', async (message) => {
            logger.debug(`Permission response: ${JSON.stringify(message)}`);

            const id = message.id;
            const pending = this.pendingRequests.get(id);

            if (!pending) {
                logger.debug('Permission request not found or already resolved');
                return;
            }

            // Store the response with timestamp
            this.responses.set(id, { ...message, receivedAt: Date.now() });
            this.pendingRequests.delete(id);

            // Handle the permission response based on tool type
            this.handlePermissionResponse(message, pending);

            // Move processed request to completedRequests
            this.session.client.updateAgentState((currentState) => {
                const request = currentState.requests?.[id];
                if (!request) return currentState;
                let r = { ...currentState.requests };
                delete r[id];
                return {
                    ...currentState,
                    requests: r,
                    completedRequests: {
                        ...currentState.completedRequests,
                        [id]: {
                            tool: request.tool,
                            createdAt: request.createdAt,
                            completedAt: Date.now(),
                            status: message.approved ? 'approved' : 'denied',
                            reason: message.reason,
                            mode: message.mode,
                            allowTools: message.allowTools
                        }
                    }
                };
            });
        });
    }

    /**
     * Gets the responses map (for compatibility with existing code)
     */
    getResponses(): Map<string, PermissionResponse> {
        return this.responses;
    }
}
