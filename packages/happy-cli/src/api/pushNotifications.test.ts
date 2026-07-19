import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { mockGet } = vi.hoisted(() => ({
    mockGet: vi.fn(),
}))

vi.mock('axios', () => ({
    default: {
        get: mockGet,
    },
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
    },
}))

import { PushNotificationClient } from './pushNotifications'

describe('PushNotificationClient completion notifications', () => {
    let client: PushNotificationClient
    let send: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.useFakeTimers()
        delete process.env.HAPPY_ORCH_ONESHOT
        delete process.env.HAPPY_ORCH_EXECUTION_ID
        mockGet.mockReset()
        client = new PushNotificationClient('token', 'http://server')
        send = vi.spyOn(client, 'sendToAllDevices').mockImplementation(() => undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('suppresses completion while an associated run/task is active', async () => {
        mockGet.mockResolvedValue({
            data: { ok: true, data: { activity: { run1: ['task1'] } } },
        })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockGet).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()
    })

    it('uses the real sendToAllDevices entry point after all delegated work is terminal', async () => {
        mockGet
            .mockResolvedValueOnce({
                data: { ok: true, data: { activity: { run1: ['task1'] }, totalRunCount: 1 } },
            })
            .mockResolvedValueOnce({
                data: { ok: true, data: { activity: {}, totalRunCount: 1 } },
            })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)
        expect(send).not.toHaveBeenCalled()

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(send).toHaveBeenCalledWith('Ready', 'Waiting', { sessionId: 'controller-1' })
    })

    it('still sends an ordinary ready notification after delegated run history exists', async () => {
        mockGet.mockResolvedValue({
            data: { ok: true, data: { activity: {}, totalRunCount: 9 } },
        })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(send).toHaveBeenCalledTimes(1)
    })

    it('does not send from a worker one-shot', async () => {
        process.env.HAPPY_ORCH_ONESHOT = '1'

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'worker-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockGet).not.toHaveBeenCalled()
        expect(send).not.toHaveBeenCalled()
    })

    it('retries a transient activity lookup failure a bounded number of times', async () => {
        mockGet
            .mockRejectedValueOnce(new Error('temporary'))
            .mockResolvedValueOnce({ data: { ok: true, data: { activity: {} } } })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)
        expect(mockGet).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1_000)
        expect(mockGet).toHaveBeenCalledTimes(2)
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('fails closed after bounded retries when activity lookup is permanently unavailable', async () => {
        mockGet.mockRejectedValue(new Error('offline'))

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(1_000)
        await vi.advanceTimersByTimeAsync(3_000)

        expect(mockGet).toHaveBeenCalledTimes(3)
        expect(send).not.toHaveBeenCalled()
        expect((client as any).completionChecks.size).toBe(0)

        mockGet.mockResolvedValueOnce({ data: { ok: true, data: { activity: {} } } })
        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockGet).toHaveBeenCalledTimes(4)
        expect(send).toHaveBeenCalledTimes(1)
    })

    it.each([
        '../claude/claudeRemoteLauncher.ts',
        '../codex/runCodex.ts',
        '../gemini/runGemini.ts',
    ])('keeps the provider ready entry point on delegated-aware completion: %s', (relativePath) => {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')

        expect(source).toContain('.sendCompletionToAllDevices(')
    })
})
