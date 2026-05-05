import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/domains/ai/usage-counter', () => ({
  aiTokensThisMonth: vi.fn(),
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
import { aiTokensThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('analyzeSentiment — token budget gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when budget exceeded', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, aiTokensPerMonth: 100 })
    vi.mocked(aiTokensThisMonth).mockResolvedValue(100)
    await expect(analyzeSentiment('t', 'c')).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not throw when below budget (OSS unlimited)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    await expect(analyzeSentiment('t', 'c')).resolves.toBeNull()
  })
})
