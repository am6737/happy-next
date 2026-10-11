import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_SUBMIT_TOOL_SCHEMA } from '@/orchestrator/mcpToolSchemas';
import { registerMcpTool } from './registerMcpTool';

describe('MCP schema compatibility boundary', () => {
    it('validates nested local Zod schemas and passes transformed arguments to the handler', async () => {
        const server = new McpServer({ name: 'test-server', version: '1.0.0' });
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const received: unknown[] = [];
        registerMcpTool(server, 'submit', ORCHESTRATOR_SUBMIT_TOOL_SCHEMA, async args => {
            received.push(args);
            return { content: [{ type: 'text', text: args.tasks[0].target?.type ?? 'none' }] };
        });
        try {
            await server.connect(serverTransport);
            await client.connect(clientTransport);
            const result = await client.callTool({
                name: 'submit',
                arguments: {
                    title: 'Test task',
                    tasks: [{ provider: 'codex', prompt: 'Fix the bug', target: { type: 'machine', machineId: 'machine-1' } }],
                },
            });
            expect(result.isError).not.toBe(true);
            expect(result.content).toEqual([{ type: 'text', text: 'machine_id' }]);
            const invalid = await client.callTool({
                name: 'submit', arguments: { title: 'Invalid', tasks: [{ provider: 'codex' }] },
            });
            expect(invalid.isError).toBe(true);
            expect(received).toHaveLength(1);
            expect((await client.listTools()).tools[0].inputSchema.properties).toHaveProperty('tasks');
        } finally {
            await client.close();
            await server.close();
        }
    });
});
