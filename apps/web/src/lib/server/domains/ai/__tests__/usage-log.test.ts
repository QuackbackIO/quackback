/**
 * Tests for AI usage logging helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockValues = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: mockValues }
    },
  },
  aiUsageLog: { $inferInsert: {} },
}))

describe('usage-log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValues.mockResolvedValue(undefined)
  })

  describe('logAiUsage', () => {
    it('should insert a row into ai_usage_log', async () => {
      const { logAiUsage } = await import('../usage-log')

      await logAiUsage({
        pipelineStep: 'extraction',
        callType: 'chat_completion',
        model: 'test-model',
        rawFeedbackItemId: 'raw_123',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        durationMs: 500,
        retryCount: 1,
        status: 'success',
        metadata: { promptVersion: 'v1' },
      })

      expect(mockInsert).toHaveBeenCalledTimes(1)
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineStep: 'extraction',
          callType: 'chat_completion',
          model: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          durationMs: 500,
          retryCount: 1,
          status: 'success',
        })
      )
    })

    it('should default optional fields', async () => {
      const { logAiUsage } = await import('../usage-log')

      await logAiUsage({
        pipelineStep: 'quality_gate',
        callType: 'chat_completion',
        model: 'test-model',
        inputTokens: 50,
        totalTokens: 50,
        durationMs: 200,
      })

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          outputTokens: null,
          retryCount: 0,
          status: 'success',
          error: null,
          metadata: null,
        })
      )
    })
  })

  describe('withUsageLogging', () => {
    it('should return the result and log usage on success', async () => {
      const { withUsageLogging } = await import('../usage-log')

      const mockResult = {
        choices: [{ message: { content: 'test' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      const result = await withUsageLogging(
        {
          pipelineStep: 'extraction',
          callType: 'chat_completion',
          model: 'test-model',
          rawFeedbackItemId: 'raw_1',
        },
        () => Promise.resolve({ result: mockResult, retryCount: 2 }),
        (r) => ({
          inputTokens: r.usage.prompt_tokens,
          outputTokens: r.usage.completion_tokens,
          totalTokens: r.usage.total_tokens,
        })
      )

      expect(result).toBe(mockResult)

      // Wait for fire-and-forget log to complete
      await new Promise((r) => setTimeout(r, 10))

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineStep: 'extraction',
          callType: 'chat_completion',
          model: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          retryCount: 2,
          status: 'success',
        })
      )
    })

    it('should log error row and rethrow on failure', async () => {
      const { withUsageLogging } = await import('../usage-log')

      const error = new Error('API failure') as Error & { retryCount?: number }
      error.retryCount = 3

      await expect(
        withUsageLogging(
          {
            pipelineStep: 'sentiment',
            callType: 'chat_completion',
            model: 'test-model',
            postId: 'post_1',
          },
          () => Promise.reject(error),
          () => ({ inputTokens: 0, totalTokens: 0 })
        )
      ).rejects.toThrow('API failure')

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineStep: 'sentiment',
          status: 'error',
          error: 'API failure',
          retryCount: 3,
          inputTokens: 0,
          totalTokens: 0,
        })
      )
    })

    it('should handle errors without retryCount attached', async () => {
      const { withUsageLogging } = await import('../usage-log')

      await expect(
        withUsageLogging(
          {
            pipelineStep: 'quality_gate',
            callType: 'chat_completion',
            model: 'test-model',
          },
          () => Promise.reject(new Error('timeout')),
          () => ({ inputTokens: 0, totalTokens: 0 })
        )
      ).rejects.toThrow('timeout')

      // retryCount defaults to 0 in logAiUsage when not attached to error
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          retryCount: 0,
        })
      )
    })

    it('should not fail the caller if usage logging itself fails', async () => {
      mockValues.mockRejectedValueOnce(new Error('DB down'))

      const { withUsageLogging } = await import('../usage-log')

      const result = await withUsageLogging(
        {
          pipelineStep: 'extraction',
          callType: 'chat_completion',
          model: 'test-model',
        },
        () => Promise.resolve({ result: 'ok', retryCount: 0 }),
        () => ({ inputTokens: 10, totalTokens: 10 })
      )

      expect(result).toBe('ok')
    })
  })
})
