/**
 * Chat send rate limiting: enforces the per-principal window, surfaces a retry
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

import { assertChatSendRate, ConversationRateLimitError } from '../conversation.ratelimit'

const principal = 'principal_v' as PrincipalId

beforeEach(() => vi.clearAllMocks())

describe('assertChatSendRate', () => {
  it('allows sends within the window', async () => {
    incrementBucket.mockResolvedValue({ count: 20 })
    await expect(assertChatSendRate(principal)).resolves.toBeUndefined()
  })

  it('throws once the window is exceeded, with a retry hint', async () => {
    incrementBucket.mockResolvedValue({ count: 21 })
    await expect(assertChatSendRate(principal)).rejects.toBeInstanceOf(ConversationRateLimitError)
    incrementBucket.mockResolvedValue({ count: 21 })
    await expect(assertChatSendRate(principal)).rejects.toMatchObject({ retryAfter: 30 })
  })

  it('fails open when Redis errors (count null)', async () => {
    incrementBucket.mockResolvedValue({ count: null })
    await expect(assertChatSendRate(principal)).resolves.toBeUndefined()
    expect(bucketRetryAfter).not.toHaveBeenCalled()
  })

  it('keys the bucket by principal', async () => {
    incrementBucket.mockResolvedValue({ count: 1 })
    await assertChatSendRate(principal)
    expect(incrementBucket).toHaveBeenCalledWith(
      expect.objectContaining({ key: `chat:send:${principal}` })
    )
  })
})
