import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/orchestrator/*.test.ts', 'src/daemon/*.test.ts',
    'src/codex/appserver/CodexJsonRpcPeer.test.ts'] },
  resolve: { alias: { '@': resolve('./src') } },
});
