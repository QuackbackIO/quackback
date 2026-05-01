import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => null),
  stripCodeFences: vi.fn((s: string) => s),
}))

vi.mock('@/lib/server/db', () => ({
  db: { query: { posts: { findFirst: vi.fn() } } },
  posts: { id: 'p' },
  sentiments: { id: 's' },
  eq: vi.fn(),
}))

import { analyzeSentiment } from '../sentiment.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('analyzeSentiment — aiSentiment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when aiSentiment is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, aiSentiment: false },
    })
    await expect(analyzeSentiment('t', 'c')).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not throw TierLimitError when aiSentiment is on', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // openai is null so it returns null — no TierLimitError.
    await expect(analyzeSentiment('t', 'c')).resolves.toBeNull()
  })
})
