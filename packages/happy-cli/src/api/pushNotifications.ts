import axios from 'axios'
import { logger } from '@/ui/logger'
import { Expo, ExpoPushMessage } from 'expo-server-sdk'
import { isOrchestratorWorkerSession } from '@/orchestrator/prompt'

export interface PushToken {
    id: string
    token: string
    createdAt: number
    updatedAt: number
}

const COMPLETION_CHECK_RETRY_DELAYS_MS = [1_000, 3_000] as const
const COMPLETION_CHECK_TIMEOUT_MS = 10_000


export class PushNotificationClient {
    private readonly token: string
    private readonly baseUrl: string
    private readonly expo: Expo
    private readonly completionChecks = new Map<string, Promise<void>>()

    constructor(token: string, baseUrl: string = 'https://api.happy-next.com') {
        this.token = token
        this.baseUrl = baseUrl
        this.expo = new Expo()
    }

    /**
     * Fetch all push tokens for the authenticated user
     */
    async fetchPushTokens(): Promise<PushToken[]> {
        try {
            const response = await axios.get<{ tokens: PushToken[] }>(
                `${this.baseUrl}/v1/push-tokens`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            )

            logger.debug(`Fetched ${response.data.tokens.length} push tokens`)
            
            // Log token information
            response.data.tokens.forEach((token, index) => {
                logger.debug(`[PUSH] Token ${index + 1}: id=${token.id}, created=${new Date(token.createdAt).toISOString()}, updated=${new Date(token.updatedAt).toISOString()}`)
            })
            
            return response.data.tokens
        } catch (error) {
            logger.debug('[PUSH] [ERROR] Failed to fetch push tokens:', error)
            throw new Error(`Failed to fetch push tokens: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
    }

    /**
     * Send push notification via Expo Push API with retry
     * @param messages - Array of push messages to send
     */
    async sendPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
        logger.debug(`Sending ${messages.length} push notifications`)

        // Filter out invalid push tokens
        const validMessages = messages.filter(message => {
            if (Array.isArray(message.to)) {
                return message.to.every(token => Expo.isExpoPushToken(token))
            }
            return Expo.isExpoPushToken(message.to)
        })

        if (validMessages.length === 0) {
            logger.debug('No valid Expo push tokens found')
            return
        }

        // Create chunks to respect Expo's rate limits
        const chunks = this.expo.chunkPushNotifications(validMessages)

        for (const chunk of chunks) {
            // Retry with exponential backoff for 5 minutes
            const startTime = Date.now()
            const timeout = 300000 // 5 minutes
            let attempt = 0
            
            while (true) {
                try {
                    const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk)
                    
                    // Log any errors but don't throw
                    const errors = ticketChunk.filter(ticket => ticket.status === 'error')
                    if (errors.length > 0) {
                        const errorDetails = errors.map(e => ({ message: e.message, details: e.details }))
                        logger.debug('[PUSH] Some notifications failed:', errorDetails)
                    }
                    
                    // If all notifications failed, throw to trigger retry
                    if (errors.length === ticketChunk.length) {
                        throw new Error('All push notifications in chunk failed')
                    }
                    
                    // Success - break out of retry loop
                    break
                } catch (error) {
                    const elapsed = Date.now() - startTime
                    if (elapsed >= timeout) {
                        logger.debug('[PUSH] Timeout reached after 5 minutes, giving up on chunk')
                        break
                    }
                    
                    // Calculate exponential backoff delay
                    attempt++
                    const delay = Math.min(1000 * Math.pow(2, attempt), 30000) // Max 30 seconds between retries
                    const remainingTime = timeout - elapsed
                    const waitTime = Math.min(delay, remainingTime)
                    
                    if (waitTime > 0) {
                        logger.debug(`[PUSH] Retrying in ${waitTime}ms (attempt ${attempt})`)
                        await new Promise(resolve => setTimeout(resolve, waitTime))
                    }
                }
            }
        }

        logger.debug(`Push notifications sent successfully`)
    }

    /**
     * Increment the badge count on the server and return the new value
     */
    private async incrementBadgeCount(): Promise<number> {
        try {
            const response = await axios.post<{ badgeCount: number }>(
                `${this.baseUrl}/v1/badge/increment`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            )
            return response.data.badgeCount
        } catch (error) {
            logger.debug('[PUSH] Failed to increment badge count:', error)
            return 1 // Fallback to 1 if server is unreachable
        }
    }

    /**
     * Send a push notification to all registered devices for the user
     * @param title - Notification title
     * @param body - Notification body
     * @param data - Additional data to send with the notification
     */
    sendToAllDevices(title: string, body: string, data?: Record<string, any>): void {
        logger.debug(`[PUSH] sendToAllDevices called with title: "${title}", body: "${body}"`);

        // Execute async operations without awaiting
        (async () => {
            try {
                // Fetch push tokens and increment badge count in parallel
                logger.debug('[PUSH] Fetching push tokens and incrementing badge...')
                const [tokens, badgeCount] = await Promise.all([
                    this.fetchPushTokens(),
                    this.incrementBadgeCount()
                ])
                logger.debug(`[PUSH] Fetched ${tokens.length} push tokens, badge: ${badgeCount}`)

                // Log token details for debugging
                tokens.forEach((token, index) => {
                    logger.debug(`[PUSH] Using token ${index + 1}: id=${token.id}`)
                })

                if (tokens.length === 0) {
                    logger.debug('No push tokens found for user')
                    return
                }

                // Create messages for all tokens
                const messages: ExpoPushMessage[] = tokens.map((token, index) => {
                    logger.debug(`[PUSH] Creating message ${index + 1} for token`)
                    return {
                        to: token.token,
                        title,
                        body,
                        data,
                        channelId: 'default',
                        sound: 'default',
                        priority: 'high',
                        badge: badgeCount
                    }
                })

                // Send notifications
                logger.debug(`[PUSH] Sending ${messages.length} push notifications...`)
                await this.sendPushNotifications(messages)
                logger.debug('[PUSH] Push notifications sent successfully')
            } catch (error) {
                logger.debug('[PUSH] Error sending to all devices:', error)
            }
        })()
    }

    /**
     * Send the normal ready notification after confirming that this controller
     * has no active delegated runs/tasks. A worker one-shot never sends a
     * completion notification itself; its controller receives the terminal
     * callback and performs the normal ready flow.
     *
     * Activity lookup is fail-closed. A bounded retry gives a transient server
     * failure a chance to recover without leaving an unbounded timer/request
     * alive or permanently suppressing later, independent controller turns.
     */
    sendCompletionToAllDevices(title: string, body: string, data?: Record<string, any>): void {
        if (isOrchestratorWorkerSession()) {
            logger.debug('[PUSH] Suppressing worker completion notification')
            return
        }

        const controllerSessionId = typeof data?.sessionId === 'string' ? data.sessionId : null
        if (!controllerSessionId) {
            this.sendToAllDevices(title, body, data)
            return
        }

        const previous = this.completionChecks.get(controllerSessionId) ?? Promise.resolve()
        const check = previous
            .catch(() => undefined)
            .then(() => this.checkCompletionAndSend(
                controllerSessionId,
                title,
                body,
                data,
            ))
            .finally(() => {
                if (this.completionChecks.get(controllerSessionId) === check) {
                    this.completionChecks.delete(controllerSessionId)
                }
            })
        this.completionChecks.set(controllerSessionId, check)
    }

    private async checkCompletionAndSend(
        controllerSessionId: string,
        title: string,
        body: string,
        data?: Record<string, any>,
    ): Promise<void> {
        for (let attempt = 0; attempt <= COMPLETION_CHECK_RETRY_DELAYS_MS.length; attempt++) {
            try {
                const response = await axios.get<{
                    ok?: boolean
                    data?: { activity?: unknown }
                }>(
                    `${this.baseUrl}/v1/orchestrator/activity`,
                    {
                        params: { controllerSessionId },
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: COMPLETION_CHECK_TIMEOUT_MS,
                    },
                )

                const activity = response.data?.data?.activity
                if (response.data?.ok !== true || !activity || typeof activity !== 'object' || Array.isArray(activity)) {
                    throw new Error('Invalid orchestrator activity response')
                }

                if (Object.keys(activity).length > 0) {
                    logger.debug('[PUSH] Suppressing completion notification while delegated work is active')
                    return
                }

                // Do not use totalRunCount here: completed delegated history
                // must not suppress a later ordinary controller turn.
                this.sendToAllDevices(title, body, data)
                return
            } catch (error) {
                if (attempt >= COMPLETION_CHECK_RETRY_DELAYS_MS.length) {
                    logger.debug('[PUSH] Activity lookup failed; suppressing completion notification', error)
                    return
                }
                const delayMs = COMPLETION_CHECK_RETRY_DELAYS_MS[attempt]
                logger.debug(`[PUSH] Activity lookup failed; retrying in ${delayMs}ms`, error)
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
            }
        }
    }
}
