import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockedFindFirst: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

// Mock the AI config module so we don't need real BASE_URL/SECRET_KEY env.
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
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import type { PostId } from '@quackback/ids'

describe('generateAndSavePostSummary — aiSummaries gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when aiSummaries is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, aiSummaries: false },
    })
    await expect(generateAndSavePostSummary('post_x' as PostId)).rejects.toBeInstanceOf(
      TierLimitError
    )
  })

  it('does not throw TierLimitError when aiSummaries is on', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // openai is null so it returns early — that's fine, we just want NO TierLimitError.
    await expect(generateAndSavePostSummary('post_x' as PostId)).resolves.toBeUndefined()
  })
})
