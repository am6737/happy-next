/**
 * Happy MCP STDIO Bridge
 *
 * Minimal STDIO MCP server exposing Happy tools
 * (`change_title`, `preview_html`, `orchestrator_*`) for controller sessions.
 * Orchestrator worker sessions expose no Happy tools to avoid recursive orchestration or UI side effects.
 * On invocation it forwards tool calls to an existing Happy HTTP MCP server
 * using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `HAPPY_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { request as httpRequest } from 'node:http';
import { shouldEnableOrchestratorTools } from '@/orchestrator/prompt';
import {
  ORCHESTRATOR_CANCEL_TOOL_SCHEMA,
  ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA,
  ORCHESTRATOR_LIST_TOOL_SCHEMA,
  ORCHESTRATOR_PEND_TOOL_SCHEMA,
  ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA,
  ORCHESTRATOR_SUBMIT_TOOL_SCHEMA,
} from '@/orchestrator/mcpToolSchemas';

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && i + 1 < argv.length) {
      url = argv[i + 1];
      i++;
    }
  }
  return { url };
}

async function main() {
  if (process.env.HAPPY_ORCH_BRIDGE_TOOL === 'template') {
    const socketPath = process.env.HAPPY_ORCH_TEMPLATE_SOCKET;
    if (!socketPath || !socketPath.startsWith('/')) throw new Error('Template proposal socket unavailable');
    const server = new McpServer({ name: 'Happy Template Proposal', version: '1.0.0' });
    const registerTool = (server.registerTool as unknown as (name: string, schema: unknown,
      handler: (args: Record<string, any>) => Promise<unknown>) => void).bind(server);
    registerTool('ai_template_propose', {
      title: 'Propose Agent Template Update',
      description: 'Submit a pending proposal for the current execution\'s bound Agent template. A human must review it before publication.',
      inputSchema: {
        clientRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
        content: z.object({ role: z.string(), description: z.string(), emoji: z.string(),
          skills: z.array(z.string()), responsibilities: z.array(z.string()), instructions: z.string() }),
        note: z.string(),
      },
    }, async (args) => {
      try {
        const result = await new Promise<string>((resolve, reject) => {
          const request = httpRequest({ socketPath, path: '/propose', method: 'POST',
            headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000) }, (response) => {
            let body = '';
            response.on('data', (chunk) => {
              body += chunk.toString();
              if (Buffer.byteLength(body) > 4_000) request.destroy(new Error('Proposal response too large'));
            });
            response.on('end', () => response.statusCode === 200 ? resolve(body)
              : reject(new Error(response.statusCode === 503 ? 'Template proposal server unavailable'
                : response.statusCode === 409 ? 'Template proposal input or execution scope rejected'
                  : 'Template proposal unavailable')));
          });
          request.once('error', reject);
          request.end(JSON.stringify(args));
        });
        const parsed = JSON.parse(result) as { id?: unknown; status?: unknown; duplicate?: unknown };
        if (typeof parsed.id !== 'string' || parsed.status !== 'pending'
          || typeof parsed.duplicate !== 'boolean') throw new Error('Proposal acknowledgement invalid');
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          id: parsed.id, status: 'pending', duplicate: parsed.duplicate }) }] };
      } catch (error) {
        const message = error instanceof Error && [
          'Template proposal server unavailable',
          'Template proposal input or execution scope rejected',
        ].includes(error.message) ? error.message : 'Template proposal unavailable';
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    });
    await server.connect(new StdioServerTransport());
    return;
  }
  if (process.env.HAPPY_ORCH_LEADER_PROXY_URL && process.env.HAPPY_ORCH_LEADER_CAPABILITY) {
    const server = new McpServer({ name: 'Happy Leader Delegation', version: '1.0.0' });
    const registerTool = (server.registerTool as unknown as (name: string, schema: unknown,
      handler: (args: Record<string, any>) => Promise<unknown>) => void).bind(server);
    registerTool('ai_team_delegate', {
      title: 'Delegate To Team Member',
      description: 'Create one bounded task for an enabled member of the current team. Existing sibling task IDs may be dependencies.',
      inputSchema: {
        delegationKey: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
        assignedAgentId: z.string().min(1).max(256),
        title: z.string().min(1).max(256),
        requirements: z.string().min(1).max(32_768),
        dependsOnTaskIds: z.array(z.string()).max(8).optional(),
      },
    }, async (args) => {
      try {
        const response = await fetch(process.env.HAPPY_ORCH_LEADER_PROXY_URL!, {
          method: 'POST', headers: { authorization: `Bearer ${process.env.HAPPY_ORCH_LEADER_CAPABILITY}`, 'content-type': 'application/json' },
          body: JSON.stringify(args), signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Delegation rejected: HTTP ${response.status}`);
        const result = await response.json();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Delegation failed' }] };
      }
    });
    await server.connect(new StdioServerTransport());
    return;
  }
  // Resolve target HTTP MCP URL
  const { url: urlFromArgs } = parseArgs(process.argv.slice(2));
  const baseUrl = urlFromArgs || process.env.HAPPY_HTTP_MCP_URL || '';

  if (!baseUrl) {
    // Write to stderr; never stdout.
    process.stderr.write(
      '[happy-mcp] Missing target URL. Set HAPPY_HTTP_MCP_URL or pass --url <http://127.0.0.1:PORT>\n'
    );
    process.exit(2);
  }

  let httpClient: Client | null = null;

  async function ensureHttpClient(): Promise<Client> {
    if (httpClient) return httpClient;
    const client = new Client(
      { name: 'happy-stdio-bridge', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    await client.connect(transport);
    httpClient = client;
    return client;
  }

  // Create STDIO MCP server
  const server = new McpServer({
    name: 'Happy MCP Bridge',
    version: '1.0.0',
  });
  const enableHappyTools = shouldEnableOrchestratorTools();
  const registerTool = (server.registerTool as unknown as (name: string, schema: unknown,
    handler: (args: Record<string, any>) => Promise<unknown>) => void).bind(server);

  // Helper to register a tool that forwards calls to the HTTP MCP server
  function registerForwardedTool(
    name: string,
    opts: { description: string; title: string; inputSchema: Record<string, z.ZodType> },
  ) {
    registerTool(name, opts, async (args) => {
      try {
        const client = await ensureHttpClient();
        const response = await client.callTool({ name, arguments: args });
        return response as any;
      } catch (error) {
        return {
          content: [
            { type: 'text', text: `Failed to call ${name}: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    });
  }

  if (enableHappyTools) {
    registerForwardedTool('change_title', {
      description: 'Change the title of the current chat session',
      title: 'Change Chat Title',
      inputSchema: {
        title: z.string().describe('The new title for the chat session'),
      },
    });

    registerForwardedTool('preview_html', {
      description: 'Preview an HTML page in the client app. Pass the document inline as `html`, or pass `filePath` to preview a local .html file you just generated. The document must be complete and self-contained, with all CSS and JS inlined.',
      title: 'Preview HTML',
      inputSchema: {
        html: z.string().optional().describe('Complete self-contained HTML document string'),
        filePath: z.string().optional().describe('Path to a local .html file to preview. Read by the CLI, so relative paths resolve against the session working directory'),
        title: z.string().optional().describe('Display title for the preview'),
      },
    });

    registerForwardedTool('orchestrator_get_context', ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_submit', ORCHESTRATOR_SUBMIT_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_pend', ORCHESTRATOR_PEND_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_list', ORCHESTRATOR_LIST_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_cancel', ORCHESTRATOR_CANCEL_TOOL_SCHEMA);
    registerForwardedTool('orchestrator_send_message', ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA);
  }

  // Start STDIO transport
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

// Start and surface fatal errors to stderr only
main().catch((err) => {
  try {
    process.stderr.write(`[happy-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.exit(1);
  }
});
