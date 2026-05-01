import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => null),
  stripCodeFences: vi.fn((s: string) => s),
}))

import { assessMergeCandidates } from '../merge-assessment.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('assessMergeCandidates — aiMergeSuggestions gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sourcePost = { id: 'p1', title: 'a', content: 'b' } as never

  it('throws TierLimitError when aiMergeSuggestions is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, aiMergeSuggestions: false },
    })
    await expect(assessMergeCandidates(sourcePost, [])).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not throw when aiMergeSuggestions is on', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    await expect(assessMergeCandidates(sourcePost, [])).resolves.toEqual([])
  })
})
