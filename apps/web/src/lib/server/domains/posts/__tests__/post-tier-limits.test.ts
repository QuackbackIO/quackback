import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => {
  return {
    mockedSelect: vi.fn(),
    mockedFindFirstBoards: vi.fn(),
    mockedFindFirstStatuses: vi.fn(),
  }
})

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    db: {
      query: {
        boards: { findFirst: (...args: unknown[]) => hoisted.mockedFindFirstBoards(...args) },
        postStatuses: {
          findFirst: (...args: unknown[]) => hoisted.mockedFindFirstStatuses(...args),
        },
      },
      select: hoisted.mockedSelect,
    },
    boards: { id: 'board_id' },
    posts: { id: 'post_id', deletedAt: 'deleted_at' },
    postStatuses: { id: 'status_id', slug: 'slug' },
    postTags: { postId: 'post_id', tagId: 'tag_id' },
    tags: { id: 'tag_id' },
    votes: { id: 'votes_id' },
    principal: { id: 'principal_id' },
    eq: vi.fn(() => 'eq-clause'),
    inArray: vi.fn(),
    sql: realSql,
  }
})

const { mockedSelect, mockedFindFirstBoards } = hoisted

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostCreated: vi.fn(),
  dispatchPostStatusChanged: vi.fn(),
  dispatchPostUpdated: vi.fn(),
  buildEventActor: vi.fn((actor) => actor),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({})),
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json) => json),
}))

import { createPost } from '../post.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import type { BoardId, PrincipalId } from '@quackback/ids'

describe('createPost — maxPosts enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when at maxPosts cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      maxPosts: 1,
    })
    // Make the count query return 1 (at limit).
    mockedSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ count: 1 }]),
      }),
    })

    await expect(
      createPost(
        {
          boardId: 'brd_test' as BoardId,
          title: 'should be blocked',
        },
        { principalId: 'prn_test' as PrincipalId }
      )
    ).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not enforce when maxPosts is null (OSS default)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // The count query should never be called when limit is null.
    mockedSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ count: 9999 }]),
      }),
    })
    // Other mocks need to fail in some non-TierLimitError way to confirm
    // the tier-limit gate did not fire.
    mockedFindFirstBoards.mockResolvedValue(null)

    await expect(
      createPost(
        {
          boardId: 'brd_missing' as BoardId,
          title: 'should reach board lookup',
        },
        { principalId: 'prn_test' as PrincipalId }
      )
    ).rejects.not.toBeInstanceOf(TierLimitError)
  })
})
