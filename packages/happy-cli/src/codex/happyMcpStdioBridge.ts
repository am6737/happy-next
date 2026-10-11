/**
 * Happy MCP STDIO Bridge
 *
 * Minimal STDIO MCP server that mirrors the tools of an existing Happy HTTP MCP server
 * (`change_title`, `preview_html`, `orchestrator_*`, Agent tools such as `chat_send`).
 * The HTTP server decides which tools a session gets, so the bridge forwards its tool
 * list and calls unchanged using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `HAPPY_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Matches Codex's tool_timeout_sec for Happy tools; Agent work_session_start may clone for up to 15 minutes.
const TOOL_CALL_TIMEOUT_MS = 20 * 60_000;

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
  const server = new Server(
    { name: 'Happy MCP Bridge', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      const client = await ensureHttpClient();
      return await client.listTools(request.params);
    } catch (error) {
      process.stderr.write(`[happy-mcp] Failed to list tools: ${error instanceof Error ? error.message : String(error)}\n`);
      return { tools: [] };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    try {
      const client = await ensureHttpClient();
      return await client.callTool(request.params, undefined, { timeout: TOOL_CALL_TIMEOUT_MS });
    } catch (error) {
      return {
        content: [
          { type: 'text' as const, text: `Failed to call ${name}: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  });

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
