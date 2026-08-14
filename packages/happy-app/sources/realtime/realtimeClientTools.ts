import { router } from 'expo-router';
import { sync } from '@/sync/sync';
import { sessionAllow, sessionDeny, sessionDelete, machineSpawnNewSession } from '@/sync/ops';
import { storage, getSession } from '@/sync/storage';
import { trackPermissionResponse } from '@/track';
import { getCurrentRealtimeSessionId, setCurrentRealtimeSessionId, stopRealtimeSession } from './RealtimeSession';
import { getSessionName, getSessionSubtitle, isSessionOnline, formatPathRelativeToHome } from '@/utils/sessionUtils';
import {
    changeSessionSettingsParametersSchema,
    deleteSessionParametersSchema,
    getLatestAssistantReplyParametersSchema,
    listSessionsParametersSchema,
    messageHappyCodeParametersSchema,
    processPermissionRequestParametersSchema,
    switchSessionParametersSchema,
    getVoicePermissionModesForAgent,
    isVoicePermissionModeForAgent,
    resolveVoicePermissionAgent,
} from './voiceToolContracts';
import { getActionConfirmation } from '@/sync/voiceConfig';
import { showSendConfirmation, showCreateConfirmation, showDeleteConfirmation } from './ActionConfirmationModal';
import { showSessionPicker } from './SessionPickerModal';
import { ModalRegistry } from './voiceModalRegistry';
import { t } from '@/text';
import { Modal } from '@/modal';
import type { Session } from '@/sync/storageTypes';

type SessionRefResult =
    | { kind: 'found'; session: Session }
    | { kind: 'not-found' }
    | { kind: 'ambiguous'; matches: Session[] };

// Resolve a session reference (id or case-insensitive name match) so voice users
// can say "switch to fix login bug" instead of having to dictate a UUID.
function resolveSessionRef(ref: string): SessionRefResult {
    const direct = getSession(ref);
    if (direct) return { kind: 'found', session: direct };

    const target = ref.trim().toLowerCase();
    if (!target) return { kind: 'not-found' };

    const all = Object.values(storage.getState().sessions);
    const matches = all.filter(s => getSessionName(s).trim().toLowerCase() === target);
    if (matches.length === 1) return { kind: 'found', session: matches[0] };
    if (matches.length > 1) return { kind: 'ambiguous', matches };
    return { kind: 'not-found' };
}

// Local + realtime cleanup after a successful sessionDelete. If the deleted
// session was the active voice-chat target, the voice assistant would otherwise
// keep operating on a phantom id; clear it and navigate home.
function finishSessionDeletion(sessionId: string): void {
    storage.getState().deleteSession(sessionId);
    if (getCurrentRealtimeSessionId() === sessionId) {
        setCurrentRealtimeSessionId(null);
        try { router.replace('/'); } catch (_) { /* router may already be at root */ }
    }
}

function formatPickerList(sessions: Session[], intent: 'switch' | 'delete'): string {
    const machines = storage.getState().machines;
    const lines = sessions.map((s, i) => {
        const name = getSessionName(s);
        const machineId = s.metadata?.machineId;
        const machine = machineId ? machines[machineId] : null;
        const homeDir = machine?.metadata?.homeDir;
        const path = formatPathRelativeToHome(s.metadata?.path ?? '', homeDir);
        const machineName = machine?.metadata?.displayName ?? machine?.metadata?.host ?? machineId;
        const location = [path, machineName].filter(Boolean).join(' on ');
        const isCurrent = s.id === getCurrentRealtimeSessionId();
        const tag = isCurrent ? ' (current)' : '';
        return `${i + 1}. ${name}${tag}${location ? ` [${location}]` : ''} (id: ${s.id})`;
    });
    const header = intent === 'switch'
        ? `You have ${sessions.length} sessions — switch to which one?`
        : `You have ${sessions.length} sessions — delete which one?`;
    const footer = 'Reply with "the Nth one" or the session name; say "cancel" to back out.';
    return `${header}\n${lines.join('\n')}\n${footer}`;
}

function getLatestAssistantReplyFromCurrentSession(maxChars: number): string | null {
    const sessionId = getCurrentRealtimeSessionId();
    if (!sessionId) {
        return null;
    }

    const sessionMessages = storage.getState().sessionMessages[sessionId];
    const messages = sessionMessages?.messages ?? [];
    // messages are sorted descending (newest first), so iterate from index 0
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.kind !== 'agent-text') {
            continue;
        }
        const text = message.text?.trim();
        if (!text) {
            continue;
        }
        if (text.length <= maxChars) {
            return text;
        }
        return `${text.slice(0, maxChars)}...`;
    }

    return null;
}

/**
 * Static client tools for the realtime voice interface.
 * These tools allow the voice assistant to interact with the active coding agent.
 */
export const realtimeClientTools = {
    /**
     * Send a message to the active coding agent
     */
    messageHappyCode: async (parameters: unknown) => {
        // Parse and validate the message parameter using Zod
        const parsedMessage = messageHappyCodeParametersSchema.safeParse(parameters);

        if (!parsedMessage.success) {
            console.error('❌ Invalid message parameter:', parsedMessage.error);
            return "error (invalid message parameter)";
        }

        const message = parsedMessage.data.message;
        const sessionId = getCurrentRealtimeSessionId();
        
        if (!sessionId) {
            console.error('❌ No active session');
            return "error (no active session)";
        }
        
        console.log('🔍 messageHappyCode called with:', message);
        console.log('📤 Sending message to session:', sessionId);

        if (getActionConfirmation()) {
            // Happy Voice supports async tool results via RPC, so we await the
            // confirmation and report the real outcome back to the assistant.
            const result = await showSendConfirmation(message);
            if (result === 'sent') {
                console.log('📤 Confirmed, sending message to session:', sessionId);
                sync.sendMessage(sessionId, message);
                return 'sent';
            }
            console.log('🚫 Message cancelled by user');
            return 'cancelled by user';
        }

        sync.sendMessage(sessionId, message);
        return "sent";
    },

    /**
     * Process a permission request from the coding agent
     */
    processPermissionRequest: async (parameters: unknown) => {
        const parsedMessage = processPermissionRequestParametersSchema.safeParse(parameters);

        if (!parsedMessage.success) {
            console.error('❌ Invalid decision parameter:', parsedMessage.error);
            return "error (invalid decision parameter, expected 'allow' or 'deny')";
        }

        const decision = parsedMessage.data.decision;
        const sessionId = getCurrentRealtimeSessionId();
        
        if (!sessionId) {
            console.error('❌ No active session');
            return "error (no active session)";
        }
        
        console.log('🔍 processPermissionRequest called with:', decision);
        
        // Get the current session to check for permission requests
        const session = getSession(sessionId);
        const requests = session?.agentState?.requests;
        
        if (!requests || Object.keys(requests).length === 0) {
            console.error('❌ No active permission request');
            return "error (no active permission request)";
        }
        
        const requestId = Object.keys(requests)[0];
        
        try {
            if (decision === 'allow') {
                await sessionAllow(sessionId, requestId);
                trackPermissionResponse(true);
            } else {
                await sessionDeny(sessionId, requestId);
                trackPermissionResponse(false);
            }
            return "done";
        } catch (error) {
            console.error('❌ Failed to process permission:', error);
            return `error (failed to ${decision} permission)`;
        }
    },

    /**
     * List all sessions: opens the picker modal AND returns the ordered list
     * text so the LLM can read out the first few entries.
     */
    listSessions: async (parameters: unknown) => {
        const parsed = listSessionsParametersSchema.safeParse(parameters ?? {});
        if (!parsed.success) {
            console.error('❌ Invalid listSessions parameters:', parsed.error);
            return "error (invalid parameters)";
        }
        const { includeOffline } = parsed.data;

        const { orderedSessions } = showSessionPicker({
            title: t('voiceActionConfirmation.pickerTitle'),
            intent: 'switch',
            includeOffline,
            onSelect: async (s) => {
                setCurrentRealtimeSessionId(s.id);
                router.navigate(`/session/${s.id}`);
            },
        });

        if (orderedSessions.length === 0) {
            return t('voiceActionConfirmation.emptyState');
        }

        return formatPickerList(orderedSessions, 'switch');
    },

    /**
     * Switch to a different session. No args → opens picker. With sessionId →
     * resolves picker (if open) and performs the switch.
     */
    switchSession: async (parameters: unknown) => {
        const parsed = switchSessionParametersSchema.safeParse(parameters ?? {});
        if (!parsed.success) {
            console.error('❌ Invalid switchSession parameters:', parsed.error);
            return "error (invalid parameters)";
        }
        const { sessionId } = parsed.data;

        if (!sessionId) {
            const { orderedSessions } = showSessionPicker({
                title: t('voiceActionConfirmation.pickerSwitchTitle'),
                intent: 'switch',
                onSelect: async (s) => {
                    setCurrentRealtimeSessionId(s.id);
                    router.navigate(`/session/${s.id}`);
                },
            });
            if (orderedSessions.length === 0) {
                return t('voiceActionConfirmation.emptyState');
            }
            return formatPickerList(orderedSessions, 'switch');
        }

        const ref = resolveSessionRef(sessionId);
        if (ref.kind === 'not-found') {
            return "error (session not found — call switchSession with no args to see available sessions)";
        }
        if (ref.kind === 'ambiguous') {
            return `error (multiple sessions named "${sessionId}", call with no args to disambiguate)`;
        }
        const session = ref.session;

        // Close any open picker so we don't leave stale UI behind. Scoped to
        // pickers so an in-flight sendConfirmation countdown isn't killed.
        ModalRegistry.dismissCurrentPicker();

        try {
            setCurrentRealtimeSessionId(session.id);
            router.navigate(`/session/${session.id}`);
            return `Switched to session "${getSessionName(session)}".`;
        } catch (error) {
            console.error('❌ Failed to switch session:', error);
            return "error (failed to navigate to session)";
        }
    },

    /**
     * Create a new session. Directory + machine are derived from the active
     * voice-chat session, then from /new wizard history; nothing else. Then
     * shows a countdown confirmation modal — countdown to zero creates.
     */
    createSession: async (_parameters: unknown) => {
        const currentSessionId = getCurrentRealtimeSessionId();
        const currentSession = currentSessionId ? getSession(currentSessionId) ?? null : null;

        let machineId: string | undefined;
        let directory: string | undefined;
        if (currentSession?.metadata?.machineId && currentSession.metadata.path) {
            machineId = currentSession.metadata.machineId;
            directory = currentSession.metadata.path;
        } else {
            const recent = storage.getState().settings.recentMachinePaths?.[0];
            if (recent) {
                machineId = recent.machineId;
                directory = recent.path;
            }
        }

        if (!machineId || !directory) {
            return "error (no directory available — open a session first or pick a path in /new)";
        }

        const machine = storage.getState().machines[machineId];
        const machineName = machine?.metadata?.displayName ?? machine?.metadata?.host ?? machineId;
        const homeDir = machine?.metadata?.homeDir;
        const displayDir = formatPathRelativeToHome(directory, homeDir);

        if (getActionConfirmation()) {
            const result = await showCreateConfirmation(displayDir, machineName);
            if (result !== 'confirmed') {
                return "cancelled by user";
            }
        }

        try {
            const spawn = await machineSpawnNewSession({ machineId, directory });
            if (spawn.type === 'success') {
                setCurrentRealtimeSessionId(spawn.sessionId);
                router.navigate(`/session/${spawn.sessionId}`);
                return `Created new session in "${displayDir}".`;
            } else if (spawn.type === 'requestToApproveDirectoryCreation') {
                return `error (directory "${spawn.directory}" no longer exists on the machine)`;
            } else {
                return `error (${spawn.errorMessage})`;
            }
        } catch (error) {
            console.error('❌ Failed to create session:', error);
            return "error (failed to create session)";
        }
    },

    /**
     * Change the active session's permission mode
     */
    changeSessionSettings: async (parameters: unknown) => {
        const parsed = changeSessionSettingsParametersSchema.safeParse(parameters);

        if (!parsed.success) {
            console.error('❌ Invalid changeSessionSettings parameters:', parsed.error);
            return "error (invalid parameters)";
        }

        const { mode } = parsed.data;
        const sessionId = getCurrentRealtimeSessionId();

        if (!sessionId) {
            return "error (no active session)";
        }

        try {
            const session = getSession(sessionId);
            const agent = resolveVoicePermissionAgent(session?.metadata?.flavor);
            const validModes = getVoicePermissionModesForAgent(agent);
            if (!isVoicePermissionModeForAgent(agent, mode)) {
                return `error (invalid permission mode for ${agent}. Valid modes: ${validModes.join(', ')})`;
            }
            storage.getState().updateSessionPermissionMode(sessionId, mode);
            return `Permission mode changed to "${mode}".`;
        } catch (error) {
            console.error('❌ Failed to change permission mode:', error);
            return "error (failed to change permission mode)";
        }
    },

    /**
     * Get current session status
     */
    getSessionStatus: async (_parameters: unknown) => {
        const sessionId = getCurrentRealtimeSessionId();

        if (!sessionId) {
            return "error (no active session)";
        }

        const session = getSession(sessionId);
        if (!session) {
            return "error (session not found)";
        }

        const name = getSessionName(session);
        const path = getSessionSubtitle(session);
        const online = isSessionOnline(session) ? 'online' : 'offline';
        const thinking = session.thinking ? 'yes, AI is currently working' : 'no';
        const permissionMode = session.permissionMode || 'default';
        const model = session.modelMode || 'default';
        const pendingRequests = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0;

        return `Session status:\n- Name: ${name}\n- Path: ${path}\n- Status: ${online}\n- AI thinking: ${thinking}\n- Permission mode: ${permissionMode}\n- Model: ${model}\n- Pending permission requests: ${pendingRequests}`;
    },

    /**
     * Get the latest assistant text reply from current session
     */
    getLatestAssistantReply: async (parameters: unknown) => {
        const parsed = getLatestAssistantReplyParametersSchema.safeParse(parameters ?? {});

        if (!parsed.success) {
            console.error('❌ Invalid getLatestAssistantReply parameters:', parsed.error);
            return 'error (invalid parameters)';
        }

        const sessionId = getCurrentRealtimeSessionId();
        if (!sessionId) {
            return "error (no active session)";
        }

        const maxChars = parsed.data.maxChars ?? 2000;
        const latestReply = getLatestAssistantReplyFromCurrentSession(maxChars);
        if (!latestReply) {
            return 'No recent assistant reply found in the current session.';
        }

        return `Latest assistant reply:\n${latestReply}`;
    },

    /**
     * Delete (archive) a session. No args → picker (tap = instant delete, voice
     * "the Nth" → LLM follows up with sessionId). With sessionId → countdown
     * confirmation modal, archive on confirm.
     */
    deleteSessionTool: async (parameters: unknown) => {
        const parsed = deleteSessionParametersSchema.safeParse(parameters ?? {});
        if (!parsed.success) {
            console.error('❌ Invalid deleteSession parameters:', parsed.error);
            return "error (invalid parameters)";
        }
        const { sessionId } = parsed.data;

        if (!sessionId) {
            const { orderedSessions } = showSessionPicker({
                title: t('voiceActionConfirmation.pickerDeleteTitle'),
                intent: 'delete',
                onSelect: async (s) => {
                    try {
                        const result = await sessionDelete(s.id);
                        if (result.success) {
                            finishSessionDeletion(s.id);
                        } else {
                            Modal.alert(t('common.error'), result.message || 'Failed to delete session.');
                        }
                    } catch (error) {
                        console.error('❌ Failed to delete session via tap:', error);
                        Modal.alert(t('common.error'), error instanceof Error ? error.message : String(error));
                    }
                },
            });
            if (orderedSessions.length === 0) {
                return t('voiceActionConfirmation.emptyState');
            }
            return formatPickerList(orderedSessions, 'delete');
        }

        const ref = resolveSessionRef(sessionId);
        if (ref.kind === 'not-found') {
            return "error (session not found — call deleteSessionTool with no args to see available sessions)";
        }
        if (ref.kind === 'ambiguous') {
            return `error (multiple sessions named "${sessionId}", call with no args to disambiguate)`;
        }
        const session = ref.session;
        const sessionName = getSessionName(session);

        // Close any open picker before we put up the countdown modal. Scoped
        // to pickers so an unrelated countdown (e.g. sendConfirmation) survives.
        ModalRegistry.dismissCurrentPicker();

        if (getActionConfirmation()) {
            const result = await showDeleteConfirmation(sessionName);
            if (result !== 'confirmed') {
                return "cancelled by user";
            }
        }

        try {
            const delResult = await sessionDelete(session.id);
            if (delResult.success) {
                finishSessionDeletion(session.id);
                return "Session deleted.";
            } else {
                return `error (${delResult.message || 'failed to delete session'})`;
            }
        } catch (error) {
            console.error('❌ Failed to delete session:', error);
            return "error (failed to delete session)";
        }
    },

    /**
     * Navigate to home screen (leave current conversation)
     */
    navigateHome: async (_parameters: unknown) => {
        try {
            try { router.dismissAll(); } catch (_) { /* stack may already be at root */ }
            router.replace('/');
            return "Navigated to home screen.";
        } catch (error) {
            console.error('❌ Failed to navigate home:', error);
            return "error (failed to navigate home)";
        }
    },

    /**
     * End the voice conversation (disconnect voice assistant)
     */
    endVoiceConversation: async (_parameters: unknown) => {
        try {
            await stopRealtimeSession();
            return "Voice conversation ended.";
        } catch (error) {
            console.error('❌ Failed to end voice conversation:', error);
            return "error (failed to end voice conversation)";
        }
    },

    /**
     * Cancel whatever voice confirmation modal is currently visible.
     */
    cancelPendingAction: async (_parameters: unknown) => {
        const dismissed = ModalRegistry.dismissCurrent();
        return dismissed ? 'cancelled' : 'nothing to cancel';
    },
};
