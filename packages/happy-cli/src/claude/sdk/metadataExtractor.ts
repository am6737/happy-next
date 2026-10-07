/**
 * SDK Metadata Extractor
 * Captures available tools and slash commands from Claude SDK initialization
 */

import { query } from './query'
import type { SDKSystemMessage } from './types'
import { logger } from '@/ui/logger'
import { buildClaudeSlashCommandMetadata, type ClaudeSlashCommandMetadata } from '../utils/slashCommandMetadata'

export interface SDKMetadata {
    tools?: string[]
    slashCommands?: string[]
    slashCommandMetadata?: ClaudeSlashCommandMetadata[]
}

/**
 * Extract SDK metadata by running a minimal query and capturing the init message
 * @returns SDK metadata containing tools and slash commands
 */
export async function extractSDKMetadata(): Promise<SDKMetadata> {
    const abortController = new AbortController()
    
    try {
        logger.debug('[metadataExtractor] Starting SDK metadata extraction')
        
        // Stream-json input (rather than a plain prompt string) so we can also send control requests.
        async function* prompt() {
            yield { type: 'user' as const, message: { role: 'user' as const, content: 'hello' } }
        }

        // Run SDK with minimal tools allowed
        const sdkQuery = query({
            prompt: prompt(),
            options: {
                allowedTools: ['Bash(echo)'],
                maxTurns: 1,
                abort: abortController.signal
            }
        })

        // The init message only has command names; the `initialize` response also has descriptions
        // (including for built-in skills that have no file on disk).
        const sdkCommands = sdkQuery.supportedCommands()

        // Wait for the first system message which contains tools and slash commands
        for await (const message of sdkQuery) {
            if (message.type === 'system' && message.subtype === 'init') {
                const systemMessage = message as SDKSystemMessage
                
                const metadata: SDKMetadata = {
                    tools: systemMessage.tools,
                    slashCommands: systemMessage.slash_commands,
                    slashCommandMetadata: buildClaudeSlashCommandMetadata({
                        slashCommands: systemMessage.slash_commands,
                        skills: systemMessage.skills,
                        plugins: systemMessage.plugins,
                        sdkCommands: await sdkCommands,
                        cwd: systemMessage.cwd,
                    })
                }
                
                logger.debug('[metadataExtractor] Captured SDK metadata:', metadata)
                
                // Abort the query since we got what we need
                abortController.abort()
                
                return metadata
            }
        }
        
        logger.debug('[metadataExtractor] No init message received from SDK')
        return {}
        
    } catch (error) {
        // Check if it's an abort error (expected)
        if (error instanceof Error && error.name === 'AbortError') {
            logger.debug('[metadataExtractor] SDK query aborted after capturing metadata')
            return {}
        }
        logger.debug('[metadataExtractor] Error extracting SDK metadata:', error)
        return {}
    }
}

/**
 * Extract SDK metadata asynchronously without blocking
 * Fires the extraction and updates metadata when complete
 */
export function extractSDKMetadataAsync(onComplete: (metadata: SDKMetadata) => void): void {
    extractSDKMetadata()
        .then(metadata => {
            if (metadata.tools || metadata.slashCommands || metadata.slashCommandMetadata) {
                onComplete(metadata)
            }
        })
        .catch(error => {
            logger.debug('[metadataExtractor] Async extraction failed:', error)
        })
}