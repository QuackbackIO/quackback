import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'

const mockEq = vi.fn((col, val) => ({ _tag: 'eq', col, val }))
const mockOr = vi.fn((...args) => ({ _tag: 'or', args }))
const mockIsNull = vi.fn((col) => ({ _tag: 'isNull', col }))
const mockInArray = vi.fn((col, arr) => ({ _tag: 'inArray', col, arr }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockDesc = vi.fn((col) => ({ _tag: 'desc', col }))
const mockSql = vi.fn(() => ({ _tag: 'sql', as: vi.fn(() => ({ _tag: 'sql_as' })) }))
const mockGte = vi.fn((col, val) => ({ _tag: 'gte', col, val }))

const mockPosts = {
  id: Symbol('posts.id'),
  statusId: Symbol('posts.statusId'),
  canonicalPostId: Symbol('posts.canonicalPostId'),
  deletedAt: Symbol('posts.deletedAt'),
  boardId: Symbol('posts.boardId'),
  voteCount: Symbol('posts.voteCount'),
  commentCount: Symbol('posts.commentCount'),
  principalId: Symbol('posts.principalId'),
  title: Symbol('posts.title'),
  content: Symbol('posts.content'),
  createdAt: Symbol('posts.createdAt'),
  pinnedAt: Symbol('posts.pinnedAt'),
  searchVector: Symbol('posts.searchVector'),
}

const mockBoards = {
  isPublic: Symbol('boards.isPublic'),
  id: Symbol('boards.id'),
  slug: Symbol('boards.slug'),
  name: Symbol('boards.name'),
}

const mockPostStatuses = {
  id: Symbol('postStatuses.id'),
  category: Symbol('postStatuses.category'),
  slug: Symbol('postStatuses.slug'),
}

const SUBQUERY_MARKER = Symbol('status_subquery')
const mockSubWhere = vi.fn().mockReturnValue(SUBQUERY_MARKER)

const mockMainOffset = vi.fn().mockResolvedValue([])
const mockMainLimit = vi.fn().mockReturnValue({ offset: mockMainOffset })
const mockMainOrderBy = vi.fn().mockReturnValue({ limit: mockMainLimit })
const mockMainWhere = vi.fn().mockReturnValue({ orderBy: mockMainOrderBy })
const mockMainInnerJoin = vi.fn().mockReturnValue({ where: mockMainWhere })

const mockPostTagAssignments = {
  postId: Symbol('postTagAssignments.postId'),
  tagId: Symbol('postTagAssignments.tagId'),
}

const mockPostTags = {
  id: Symbol('postTags.id'),
  name: Symbol('postTags.name'),
  color: Symbol('postTags.color'),
  isPublic: Symbol('postTags.isPublic'),
}

// tagIds filter subquery: selectDistinct(...).from(postTagAssignments).innerJoin(postTags).where(...)
const TAG_SUBQUERY_MARKER = Symbol('tag_subquery')
const mockTagSubWhere = vi.fn().mockReturnValue(TAG_SUBQUERY_MARKER)
const mockTagSubInnerJoin = vi.fn().mockReturnValue({ where: mockTagSubWhere })

// Route based on which table is passed to .from(): postStatuses = subquery chain, posts = main chain
const mockDbSelect = vi.fn().mockImplementation(() => ({
  from: vi.fn().mockImplementation((table) => {
    if (table === mockPostStatuses) {
      return { where: mockSubWhere }
    }
    return { innerJoin: mockMainInnerJoin }
  }),
}))

const mockDbSelectDistinct = vi.fn().mockImplementation(() => ({
  from: vi.fn().mockImplementation((table) => {
    if (table === mockPostTagAssignments) {
      return { innerJoin: mockTagSubInnerJoin }
    }
    throw new Error('unexpected selectDistinct table')
  }),
}))

vi.mock('@/lib/server/db', () => ({
  db: { select: mockDbSelect, selectDistinct: mockDbSelectDistinct },
  eq: mockEq,
  and: mockAnd,
  or: mockOr,
  isNull: mockIsNull,
  inArray: mockInArray,
  desc: mockDesc,
  sql: mockSql,
  gte: mockGte,
  posts: mockPosts,
  boards: mockBoards,
  postStatuses: mockPostStatuses,
  postTagAssignments: mockPostTagAssignments,
  postTags: mockPostTags,
  postVotes: { postId: Symbol('postVotes.postId'), principalId: Symbol('postVotes.principalId') },
  principal: { id: Symbol('principal.id') },
}))

describe('listPublicPostsWithVotesAndAvatars — default status filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubWhere.mockReturnValue(SUBQUERY_MARKER)
    mockMainOffset.mockResolvedValue([])
    mockMainLimit.mockReturnValue({ offset: mockMainOffset })
    mockMainOrderBy.mockReturnValue({ limit: mockMainLimit })
    mockMainWhere.mockReturnValue({ orderBy: mockMainOrderBy })
    mockMainInnerJoin.mockReturnValue({ where: mockMainWhere })
  })

  it('restricts to active-category statuses when no status filter is provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({})

    expect(mockEq).toHaveBeenCalledWith(mockPostStatuses.category, 'active')
    expect(mockIsNull).toHaveBeenCalledWith(mockPosts.statusId)
    expect(mockOr).toHaveBeenCalled()
  })

  it('does not apply the default category filter when statusSlugs are provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ statusSlugs: ['open', 'under_review'] })

    const activeFilterApplied = mockEq.mock.calls.some(
      ([col, val]) => col === mockPostStatuses.category && val === 'active'
    )
    expect(activeFilterApplied).toBe(false)
    expect(mockOr).not.toHaveBeenCalled()
    expect(mockInArray).toHaveBeenCalledWith(mockPostStatuses.slug, ['open', 'under_review'])
  })

  it('does not apply the default category filter when statusIds are provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ statusIds: ['post_status_1' as PostStatusId] })

    const activeFilterApplied = mockEq.mock.calls.some(
      ([col, val]) => col === mockPostStatuses.category && val === 'active'
    )
    expect(activeFilterApplied).toBe(false)
    expect(mockOr).not.toHaveBeenCalled()
    expect(mockInArray).toHaveBeenCalledWith(mockPosts.statusId, ['post_status_1'])
  })
})

describe('listPublicPostsWithVotesAndAvatars — additional filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubWhere.mockReturnValue(SUBQUERY_MARKER)
    mockMainOffset.mockResolvedValue([])
    mockMainLimit.mockReturnValue({ offset: mockMainOffset })
    mockMainOrderBy.mockReturnValue({ limit: mockMainLimit })
    mockMainWhere.mockReturnValue({ orderBy: mockMainOrderBy })
    mockMainInnerJoin.mockReturnValue({ where: mockMainWhere })
  })

  it('applies gte(voteCount, n) when minVotes is provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ minVotes: 10 })

    expect(mockGte).toHaveBeenCalledWith(mockPosts.voteCount, 10)
  })

  it('does not apply minVotes condition when minVotes is 0 or unset', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ minVotes: 0 })

    const voteCountCalls = mockGte.mock.calls.filter(([col]) => col === mockPosts.voteCount)
    expect(voteCountCalls).toHaveLength(0)
  })

  it('applies gte(createdAt, …) when dateFrom is provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ dateFrom: '2026-04-01' })

    const createdAtCall = mockGte.mock.calls.find(([col]) => col === mockPosts.createdAt)
    expect(createdAtCall).toBeDefined()
    expect(createdAtCall?.[1]).toBeInstanceOf(Date)
  })

  it('applies an EXISTS(is_team_member) raw SQL when responded=responded', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ responded: 'responded' })

    // ${posts.id} interpolation splits the template into multiple fragments;
    // join them to assert the template as a whole rather than per-fragment.
    const sqlCalls = mockSql.mock.calls
    const hasExists = sqlCalls.some((call) => {
      const [fragments] = call as unknown as [TemplateStringsArray | undefined]
      if (!fragments) return false
      const combined = fragments.join('?')
      return (
        combined.includes('EXISTS') &&
        !combined.includes('NOT EXISTS') &&
        combined.includes('is_team_member')
      )
    })
    expect(hasExists).toBe(true)
  })

  it('applies a NOT EXISTS raw SQL when responded=unresponded', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ responded: 'unresponded' })

    const sqlCalls = mockSql.mock.calls
    const hasNotExists = sqlCalls.some((call) => {
      const [fragments] = call as unknown as [TemplateStringsArray | undefined]
      if (!fragments) return false
      const combined = fragments.join('?')
      return combined.includes('NOT EXISTS') && combined.includes('is_team_member')
    })
    expect(hasNotExists).toBe(true)
  })

  it('applies the active-category default alongside minVotes (status default is gated only on status absence)', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ minVotes: 5 })

    expect(mockEq).toHaveBeenCalledWith(mockPostStatuses.category, 'active')
    expect(mockGte).toHaveBeenCalledWith(mockPosts.voteCount, 5)
  })
})

describe('listPublicPostsWithVotesAndAvatars — pinned posts lead every sort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubWhere.mockReturnValue(SUBQUERY_MARKER)
    mockMainOffset.mockResolvedValue([])
    mockMainLimit.mockReturnValue({ offset: mockMainOffset })
    mockMainOrderBy.mockReturnValue({ limit: mockMainLimit })
    mockMainWhere.mockReturnValue({ orderBy: mockMainOrderBy })
    mockMainInnerJoin.mockReturnValue({ where: mockMainWhere })
  })

  /** Locate the sql fragment that orders pinned posts first. */
  function pinnedFragment() {
    const idx = mockSql.mock.calls.findIndex((call) => {
      const [fragments, ...values] = call as unknown as [TemplateStringsArray, ...unknown[]]
      return values.includes(mockPosts.pinnedAt) && fragments.join('?').includes('NULLS LAST')
    })
    if (idx === -1) return undefined
    return (mockSql.mock.results[idx] as { value: unknown }).value
  }

  it.each(['top', 'new', 'trending'] as const)(
    'orders pinned posts ahead of the active sort (%s)',
    async (sort) => {
      const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

      await listPublicPostsWithVotesAndAvatars({ sort })

      const pinned = pinnedFragment()
      expect(pinned).toBeDefined()
      expect(mockMainOrderBy).toHaveBeenCalledTimes(1)
      const args = mockMainOrderBy.mock.calls[0]
      expect(args).toHaveLength(2)
      expect(args[0]).toBe(pinned)
    }
  )

  it('keeps the active sort as the tie-breaker after pinned posts', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ sort: 'new' })

    const args = mockMainOrderBy.mock.calls[0]
    expect(args[1]).toEqual({ _tag: 'desc', col: mockPosts.createdAt })
  })
})

// ---------------------------------------------------------------------------
// Tag portal visibility — internal (is_public=false) tags never reach a
// non-team viewer, neither as a filter nor attached to a post.
// ---------------------------------------------------------------------------

const TEAM_ACTOR: Actor = {
  principalId: 'principal_team' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

function isPublicFilterApplied() {
  return mockEq.mock.calls.some(([col, val]) => col === mockPostTags.isPublic && val === true)
}

/** Whether any raw-SQL template contains the `t.is_public` guard. */
function isPublicSqlFragmentEmitted() {
  return mockSql.mock.calls.some((call) => {
    const [fragments] = call as unknown as [TemplateStringsArray | undefined]
    return fragments ? fragments.join('?').includes('t.is_public = true') : false
  })
}

describe('tag portal visibility — tagIds filter subquery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubWhere.mockReturnValue(SUBQUERY_MARKER)
    mockTagSubWhere.mockReturnValue(TAG_SUBQUERY_MARKER)
    mockTagSubInnerJoin.mockReturnValue({ where: mockTagSubWhere })
    mockMainOffset.mockResolvedValue([])
    mockMainLimit.mockReturnValue({ offset: mockMainOffset })
    mockMainOrderBy.mockReturnValue({ limit: mockMainLimit })
    mockMainWhere.mockReturnValue({ orderBy: mockMainOrderBy })
    mockMainInnerJoin.mockReturnValue({ where: mockMainWhere })
  })

  it('joins the tag catalog and requires is_public for an anonymous viewer', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ tagIds: ['post_tag_1' as PostTagId] })

    expect(mockTagSubInnerJoin).toHaveBeenCalledWith(mockPostTags, expect.anything())
    expect(mockInArray).toHaveBeenCalledWith(mockPostTagAssignments.tagId, ['post_tag_1'])
    expect(isPublicFilterApplied()).toBe(true)
    expect(mockInArray).toHaveBeenCalledWith(mockPosts.id, TAG_SUBQUERY_MARKER)
  })

  it('does not restrict the tag filter for a team viewer', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({
      tagIds: ['post_tag_1' as PostTagId],
      actor: TEAM_ACTOR,
    })

    expect(mockInArray).toHaveBeenCalledWith(mockPostTagAssignments.tagId, ['post_tag_1'])
    expect(isPublicFilterApplied()).toBe(false)
  })
})

describe('tag portal visibility — tags embedded on listed posts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubWhere.mockReturnValue(SUBQUERY_MARKER)
    mockMainOffset.mockResolvedValue([])
    mockMainLimit.mockReturnValue({ offset: mockMainOffset })
    mockMainOrderBy.mockReturnValue({ limit: mockMainLimit })
    mockMainWhere.mockReturnValue({ orderBy: mockMainOrderBy })
    mockMainInnerJoin.mockReturnValue({ where: mockMainWhere })
  })

  it('listPublicPosts guards the json_agg tag subquery with is_public for an anonymous viewer', async () => {
    const { listPublicPosts } = await import('../post.public')

    await listPublicPosts({})

    expect(isPublicSqlFragmentEmitted()).toBe(true)
  })

  it('listPublicPosts leaves the json_agg tag subquery unguarded for a team viewer', async () => {
    const { listPublicPosts } = await import('../post.public')

    await listPublicPosts({ actor: TEAM_ACTOR })

    expect(isPublicSqlFragmentEmitted()).toBe(false)
  })

  it('publicTagCondition is undefined for team actors and an is_public predicate otherwise', async () => {
    const { publicTagCondition } = await import('../post.public')
    const { ANONYMOUS_ACTOR } = await import('@/lib/server/policy')

    expect(publicTagCondition(TEAM_ACTOR)).toBeUndefined()
    expect(publicTagCondition(ANONYMOUS_ACTOR)).toEqual({
      _tag: 'eq',
      col: mockPostTags.isPublic,
      val: true,
    })
  })
})
