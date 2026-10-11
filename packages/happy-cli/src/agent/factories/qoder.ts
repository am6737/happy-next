/**
 * Qoder ACP Backend - Qoder CLI agent via ACP
 *
 * `qodercli --acp` switches mode and model in place (session/set_mode,
 * session/set_model) and restores a conversation with session/load, so one
 * process serves a whole Happy session; the runner applies mode and model over
 * ACP instead of passing CLI flags.
 */

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { AcpBackend, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentFactoryOptions, McpServerConfig } from '../core';
import { agentRegistry } from '../core';
import { DefaultTransport } from '../transport';
import { logger } from '@/ui/logger';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';

export interface QoderBackendOptions extends AgentFactoryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  /** Qoder session id to restore with session/load. */
  resumeSessionId?: string;
  /** Receives the history qodercli replays while loading `resumeSessionId`. */
  onReplayedUpdate?: (update: SessionNotification['update']) => void;
}

/**
 * qodercli names an MCP tool only in a call's title, with a `call_…` id and kind
 * `other`: "change_title (happy)" in permission requests and "change_title (happy
 * MCP Server)" in session updates. Returns the name in qodercli's own form
 * (`mcp__happy__change_title`), or null for any other title.
 */
export function qoderMcpToolName(title: unknown): string | null {
  const match = String(title ?? '').match(/^(\S+) \((\S+?)(?: MCP Server)?\)$/);
  return match ? `mcp__${match[2]}__${match[1]}` : null;
}

/** ACP kinds that do not say which tool a qodercli call is. */
const QODER_UNNAMED_KINDS = new Set(['other', 'switch_mode']);

/**
 * Names the calls whose ACP kind does not say which tool they are: MCP tools by their
 * title, the rest (EnterPlanMode as `other`, ExitPlanMode as `switch_mode`) by the
 * tool name qodercli puts in `_meta.qoder`, else by the title. The tool call and its
 * permission request get the same name, though their titles differ ("EnterPlanMode",
 * then "Allow entering plan mode?"), so the app and the permission handler know the tool.
 */
export class QoderTransport extends DefaultTransport {
  nameToolCall(toolCall: { kind?: unknown; title?: unknown; _meta?: unknown }): string | null {
    if (!QODER_UNNAMED_KINDS.has(String(toolCall.kind))) return null;
    const metaName = (toolCall._meta as { qoder?: { toolName?: unknown } } | undefined)?.qoder?.toolName;
    return qoderMcpToolName(toolCall.title) || (typeof metaName === 'string' && metaName) || (typeof toolCall.title === 'string' && toolCall.title) || null;
  }
}

const qoderTransport = new QoderTransport('qoder');

export function createQoderBackend(options: QoderBackendOptions): AcpBackend {
  const command = resolveQoderCommand();
  logger.debug('[Qoder] Creating ACP backend', {
    command,
    cwd: options.cwd,
    resumeSessionId: options.resumeSessionId,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return new AcpBackend({
    agentName: 'qoder',
    cwd: options.cwd,
    command,
    args: ['--acp'],
    env: { ...options.env, ...QODER_SDK_ISOLATION_ENV },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: qoderTransport,
    resumeSessionId: options.resumeSessionId,
    onReplayedUpdate: options.onReplayedUpdate,
  });
}

export function registerQoderAgent(): void {
  agentRegistry.register('qoder', (opts) => createQoderBackend(opts));
  logger.debug('[Qoder] Registered with agent registry');
}
