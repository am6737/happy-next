#!/usr/bin/env node

/**
 * Happy Agent entry point
 *
 * This is a Docker containerized version of the happy daemon.
 * It reuses the same daemon logic but runs without local control server.
 *
 * Usage:
 *   happy-agent start --machine-id <id> --credentials <token>
 */

import { startDaemon } from 'happy-next-cli/dist/index.mjs'

// Set agent mode environment variable
process.env.HAPPY_AGENT_MODE = 'true'

// Parse minimal arguments for agent mode
const args = process.argv.slice(2)

if (args[0] === 'start') {
  console.log('[HAPPY AGENT] Starting happy-agent in Docker container...')
  console.log('[HAPPY AGENT] Machine ID:', process.env.HAPPY_MACHINE_ID || 'not set')

  // Start the daemon (reuses all happy-cli daemon logic)
  startDaemon().catch((error) => {
    console.error('[HAPPY AGENT] Failed to start:', error)
    process.exit(1)
  })
} else {
  console.log('[HAPPY AGENT] Usage: happy-agent start')
  process.exit(1)
}
