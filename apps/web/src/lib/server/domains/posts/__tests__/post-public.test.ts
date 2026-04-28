import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusId } from '@quackback/ids'

const mockEq = vi.fn((col, val) => ({ _tag: 'eq', col, val }))
const mockOr = vi.fn((...args) => ({ _tag: 'or', args }))
const mockIsNull = vi.fn((col) => ({ _tag: 'isNull', col }))
const mockInArray = vi.fn((col, arr) => ({ _tag: 'inArray', col, arr }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockDesc = vi.fn((col) => ({ _tag: 'desc', col }))
const mockSql = vi.fn(() => ({ as: vi.fn(() => ({ _tag: 'sql_as' })) }))
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

// Route based on which table is passed to .from(): postStatuses = subquery chain, posts = main chain
const mockDbSelect = vi.fn().mockImplementation(() => ({
  from: vi.fn().mockImplementation((table) => {
    if (table === mockPostStatuses) {
      return { where: mockSubWhere }
    }
    return { innerJoin: mockMainInnerJoin }
  }),
}))

vi.mock('@/lib/server/db', () => ({
  db: { select: mockDbSelect },
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
  postTags: { postId: Symbol('postTags.postId'), tagId: Symbol('postTags.tagId') },
  tags: { id: Symbol('tags.id'), name: Symbol('tags.name'), color: Symbol('tags.color') },
  votes: { postId: Symbol('votes.postId'), principalId: Symbol('votes.principalId') },
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

    await listPublicPostsWithVotesAndAvatars({ statusIds: ['status_1' as StatusId] })

    const activeFilterApplied = mockEq.mock.calls.some(
      ([col, val]) => col === mockPostStatuses.category && val === 'active'
    )
    expect(activeFilterApplied).toBe(false)
    expect(mockOr).not.toHaveBeenCalled()
    expect(mockInArray).toHaveBeenCalledWith(mockPosts.statusId, ['status_1'])
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
      const fragments = call[0] as TemplateStringsArray | undefined
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
      const fragments = call[0] as TemplateStringsArray | undefined
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
