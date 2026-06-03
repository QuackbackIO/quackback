import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import type { BoardAccess } from '@/lib/shared/db-types'

// Mock the db.select(...).from(...).innerJoin(...).where(...).limit(...)
// chain to return one seeded row. Everything else in post.access is pure
// policy composition we want to exercise for real.
const limitMock = vi.fn()
vi.mock('@/lib/server/db', () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: (...a: unknown[]) => limitMock(...a),
  }
  return {
    db: { select: () => chain },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    posts: {},
    boards: {},
    comments: {},
  }
})

import { assertPostVotable } from '../post.access'

function access(overrides: Partial<BoardAccess> = {}): BoardAccess {
  return {
    view: 'anonymous',
    vote: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    ...overrides,
  }
}

const anon = {
  principalId: null,
  role: null,
  principalType: 'anonymous' as const,
  segmentIds: new Set<never>(),
}
const admin = {
  principalId: 'p_a' as never,
  role: 'admin' as const,
  principalType: 'user' as const,
  segmentIds: new Set<never>(),
}

beforeEach(() => limitMock.mockReset())

describe('assertPostVotable', () => {
  it('throws ForbiddenError VOTE_NOT_ALLOWED when vote tier is authenticated and actor is anonymous', async () => {
    limitMock.mockResolvedValue([
      {
        moderationState: 'published',
        principalId: null,
        access: access({ vote: 'authenticated' }),
      },
    ])
    await expect(assertPostVotable('post_1' as PostId, anon)).rejects.toMatchObject({
      code: 'VOTE_NOT_ALLOWED',
    })
  })

  it('throws NotFoundError when the post/board row is absent (deleted)', async () => {
    limitMock.mockResolvedValue([])
    await expect(assertPostVotable('post_1' as PostId, anon)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError (not 403) when the actor cannot even VIEW the board', async () => {
    // view=team, vote=team: an anonymous actor is view-denied, so the
    // chokepoint must 404 (not leak existence via a 403 vote message).
    limitMock.mockResolvedValue([
      {
        moderationState: 'published',
        principalId: null,
        access: access({ view: 'team', vote: 'team' }),
      },
    ])
    await expect(assertPostVotable('post_1' as PostId, anon)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('allows a team actor regardless of vote tier', async () => {
    limitMock.mockResolvedValue([
      { moderationState: 'published', principalId: null, access: access({ vote: 'team' }) },
    ])
    await expect(assertPostVotable('post_1' as PostId, admin)).resolves.toBeUndefined()
  })

  it('allows an anonymous actor when vote tier is anonymous', async () => {
    limitMock.mockResolvedValue([
      { moderationState: 'published', principalId: null, access: access({ vote: 'anonymous' }) },
    ])
    await expect(assertPostVotable('post_1' as PostId, anon)).resolves.toBeUndefined()
  })
})

// Note: ForbiddenError exposes a `.code` field (DomainException base sets it),
// so `rejects.toMatchObject({ code: 'VOTE_NOT_ALLOWED' })` is sufficient and we
// don't need the message-substring fallback the plan mentions.
void ForbiddenError
