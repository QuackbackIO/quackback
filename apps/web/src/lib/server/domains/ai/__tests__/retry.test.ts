/**
 * Tests for retry utility with exponential backoff.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withRetry, isRetryableError } from '../retry'

describe('retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('withRetry', () => {
    it('should return { result, retryCount: 0 } on first success', async () => {
      const fn = vi.fn().mockResolvedValue('hello')

      const out = await withRetry(fn)

      expect(out).toEqual({ result: 'hello', retryCount: 0 })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on retryable error and return final retryCount', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('429 rate limit'))
        .mockRejectedValueOnce(new Error('429 rate limit'))
        .mockResolvedValue('ok')

      const out = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 })

      expect(out).toEqual({ result: 'ok', retryCount: 2 })
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should attach retryCount to error on final failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('500 internal server error'))

      let caughtError: (Error & { retryCount?: number }) | undefined
      try {
        await withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 })
      } catch (e) {
        caughtError = e as Error & { retryCount?: number }
      }

      expect(caughtError).toBeDefined()
      expect(caughtError!.retryCount).toBe(2)
      expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
    })

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Invalid JSON'))

      let caughtError: (Error & { retryCount?: number }) | undefined
      try {
        await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })
      } catch (e) {
        caughtError = e as Error & { retryCount?: number }
      }

      expect(caughtError).toBeDefined()
      expect(caughtError!.retryCount).toBe(0)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should respect maxRetries option', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

      await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow(
        'ECONNRESET'
      )

      expect(fn).toHaveBeenCalledTimes(2) // initial + 1 retry
    })
  })

  describe('isRetryableError', () => {
    it.each([
      'ECONNRESET',
      'ETIMEDOUT',
      '429 Too Many Requests',
      'rate limit exceeded',
      '500 Internal Server Error',
      '502 Bad Gateway',
      '503 Service Unavailable',
      'InferenceUpstreamError: model timeout',
    ])('should treat "%s" as retryable', (msg) => {
      expect(isRetryableError(new Error(msg))).toBe(true)
    })

    it.each(['Invalid JSON', 'Missing required field', 'Unauthorized'])(
      'should treat "%s" as non-retryable',
      (msg) => {
        expect(isRetryableError(new Error(msg))).toBe(false)
      }
    )
  })
})
