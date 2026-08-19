/**
 * Conversation send rate limiting: enforces the per-principal window, surfaces a retry
 * hint, and fails open when Redis is unavailable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const incrementBucket = vi.fn()
const bucketRetryAfter = vi.fn((..._args: unknown[]) => Promise.resolve(30))

vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => incrementBucket(...args),
  bucketRetryAfter: (...args: unknown[]) => bucketRetryAfter(...args),
}))

import { assertConversationSendRate, ConversationRateLimitError } from '../conversation.ratelimit'

const principal = 'principal_v' as PrincipalId

beforeEach(() => vi.clearAllMocks())

describe('assertConversationSendRate', () => {
  it('allows sends within the window', async () => {
    incrementBucket.mockResolvedValue({ count: 20 })
    await expect(assertConversationSendRate(principal)).resolves.toBeUndefined()
  })

  it('throws once the window is exceeded, with a retry hint', async () => {
    incrementBucket.mockResolvedValue({ count: 21 })
    await expect(assertConversationSendRate(principal)).rejects.toBeInstanceOf(
      ConversationRateLimitError
    )
    incrementBucket.mockResolvedValue({ count: 21 })
    await expect(assertConversationSendRate(principal)).rejects.toMatchObject({ retryAfter: 30 })
  })

  it('fails open when Redis errors (count null)', async () => {
    incrementBucket.mockResolvedValue({ count: null })
    await expect(assertConversationSendRate(principal)).resolves.toBeUndefined()
    expect(bucketRetryAfter).not.toHaveBeenCalled()
  })

  it('keys the bucket by principal', async () => {
    incrementBucket.mockResolvedValue({ count: 1 })
    await assertConversationSendRate(principal)
    expect(incrementBucket).toHaveBeenCalledWith(
      expect.objectContaining({ key: `conversation:send:${principal}` })
    )
  })
})
