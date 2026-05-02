import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockedFindFirst: vi.fn(),
}))

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
  db: {
    query: { posts: { findFirst: (...a: unknown[]) => hoisted.mockedFindFirst(...a) } },
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }),
  },
  posts: { id: 'p' },
  comments: {
    id: 'c',
    postId: 'pid',
    content: 'co',
    isTeamMember: 'itm',
    createdAt: 'ca',
    deletedAt: 'da',
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))

import { generateAndSavePostSummary } from '../summary.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { aiTokensThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import type { PostId } from '@quackback/ids'

describe('generateAndSavePostSummary — token budget gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when token budget is 0 (AI off)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, aiTokensPerMonth: 0 })
    vi.mocked(aiTokensThisMonth).mockResolvedValue(0)
    await expect(generateAndSavePostSummary('post_x' as PostId)).rejects.toBeInstanceOf(
      TierLimitError
    )
  })

  it('throws TierLimitError when current usage >= budget', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, aiTokensPerMonth: 1_000_000 })
    vi.mocked(aiTokensThisMonth).mockResolvedValue(1_000_000)
    await expect(generateAndSavePostSummary('post_x' as PostId)).rejects.toBeInstanceOf(
      TierLimitError
    )
  })

  it('does not throw when budget is null (OSS unlimited)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // openai is null so it returns early — we only care no TierLimitError fires.
    await expect(generateAndSavePostSummary('post_x' as PostId)).resolves.toBeUndefined()
  })

  it('does not throw when usage is below budget', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, aiTokensPerMonth: 1_000_000 })
    vi.mocked(aiTokensThisMonth).mockResolvedValue(500_000)
    await expect(generateAndSavePostSummary('post_x' as PostId)).resolves.toBeUndefined()
  })
})
