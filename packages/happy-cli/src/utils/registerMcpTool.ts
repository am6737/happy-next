import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

/** Keep local Zod inference at the SDK boundary, which can carry another Zod version. */
export function registerMcpTool<Shape extends z.ZodRawShape>(
    server: McpServer,
    name: string,
    config: { description: string; title: string; inputSchema: Shape },
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
) {
    // MCP accepts v3 schemas at runtime. Comparing separate installed Zod class
    // declarations structurally can recurse indefinitely during type checking.
    return server.registerTool(name, {
        ...config,
        inputSchema: config.inputSchema as unknown as ZodRawShapeCompat,
    }, async args => handler(args as z.infer<z.ZodObject<Shape>>));
}
