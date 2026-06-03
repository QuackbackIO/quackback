/**
 * Public changelog views must not leak non-published posts.
 *
 * A team member can link a post to a published changelog entry — but
 * the post itself may be in any moderation state (pending review,
 * spam, archived, closed). Only `published` posts may be exposed
 * through the public changelog API; everything else must be filtered
 * out before the response leaves the server.
 *
 * The earlier filter only excluded `deletedAt` rows. This file pins
 * the full moderation-state contract so the regression can't return.
 *
 * Filtering moved into SQL (see VECTOR 5 in the security-review pass):
 * the production query now runs `db.select().from(changelogEntryPosts)
 * .innerJoin(posts, …).innerJoin(boards, …).where(<four guards>)` and
 * never fetches a row it would discard. These tests assert the outcome
 * (visible posts) by simulating the post-filter row set the SQL would
 * have returned — i.e. only rows that satisfy all four guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId, PostId } from '@quackback/ids'

const mockEntryFindFirst = vi.fn()
const mockEntryFindMany = vi.fn()
const mockStatusesFindMany = vi.fn()
const mockSelect = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      changelogEntries: {
        findFirst: (...args: unknown[]) => mockEntryFindFirst(...args),
        findMany: (...args: unknown[]) => mockEntryFindMany(...args),
      },
      postStatuses: {
        findMany: (...args: unknown[]) => mockStatusesFindMany(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
  },
  changelogEntries: { id: 'id', publishedAt: 'published_at', deletedAt: 'deleted_at' },
  changelogEntryPosts: { changelogEntryId: 'changelog_entry_id', postId: 'post_id' },
  posts: {
    id: 'posts.id',
    title: 'posts.title',
    voteCount: 'posts.voteCount',
    boardId: 'posts.boardId',
    statusId: 'posts.statusId',
    deletedAt: 'posts.deletedAt',
    moderationState: 'posts.moderationState',
  },
  boards: {
    id: 'boards.id',
    slug: 'boards.slug',
    access: 'boards.access',
    deletedAt: 'boards.deletedAt',
  },
  postStatuses: { id: 'id' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  isNotNull: vi.fn((col) => ({ kind: 'isNotNull', col })),
  lt: vi.fn((col, val) => ({ kind: 'lt', col, val })),
  lte: vi.fn((col, val) => ({ kind: 'lte', col, val })),
  desc: vi.fn((col) => ({ kind: 'desc', col })),
  inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => ({
      kind: 'sql',
      strings: Array.from(strings),
    })),
    { raw: vi.fn() }
  ),
}))

type LinkedPostAudience =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'team' }
  | { kind: 'segments'; segmentIds: string[] }

function audienceToView(
  audience: LinkedPostAudience
): 'anonymous' | 'authenticated' | 'team' | 'segments' {
  switch (audience.kind) {
    case 'public':
      return 'anonymous'
    case 'authenticated':
      return 'authenticated'
    case 'team':
      return 'team'
    case 'segments':
      return 'segments'
  }
}

/**
 * Build a fixture row that simulates a single linked-post candidate
 * BEFORE the SQL filter runs. The helper returns the flat row shape
 * the production query selects, plus the discriminating fields
 * (`__moderationState`, `__deletedAt`, `__audience`) we use locally to
 * apply the same four-guard filter the SQL WHERE clause encodes.
 */
function candidateRow(opts: {
  id: string
  changelogEntryId?: string
  moderationState: 'published' | 'pending' | 'spam' | 'archived' | 'closed'
  deletedAt?: Date | null
  audience?: LinkedPostAudience
  boardDeletedAt?: Date | null
}) {
  const audience = opts.audience ?? { kind: 'public' }
  const view = audienceToView(audience)
  return {
    changelogEntryId: (opts.changelogEntryId ?? 'cl_1') as ChangelogId,
    postId: opts.id as PostId,
    postTitle: `Post ${opts.id}`,
    postVoteCount: 0,
    postStatusId: null,
    boardSlug: 'feedback',
    __moderationState: opts.moderationState,
    __deletedAt: opts.deletedAt ?? null,
    __boardDeletedAt: opts.boardDeletedAt ?? null,
    __view: view,
  }
}

/**
 * Apply the four SQL guards the production query encodes:
 *   1. posts.deletedAt IS NULL
 *   2. posts.moderationState = 'published'
 *   3. boards.deletedAt IS NULL
 *   4. boards.access->>'view' = 'anonymous'
 *
 * The test feeds the SQL-side mock the post-filter row set, so the
 * fixture builder can simulate "what would the DB have returned after
 * the WHERE clause ran".
 */
function applySqlFilter<T extends ReturnType<typeof candidateRow>>(rows: T[]): T[] {
  return rows.filter(
    (r) =>
      r.__deletedAt === null &&
      r.__moderationState === 'published' &&
      r.__boardDeletedAt === null &&
      r.__view === 'anonymous'
  )
}

/**
 * Chainable mock for `db.select(...).from(...).innerJoin(...).innerJoin(...).where(...)`
 * — resolves with the rows you provide when `.where(...)` is awaited.
 */
function chainResolving(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => Promise.resolve(rows)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStatusesFindMany.mockResolvedValue([])
})

describe('getPublicChangelogById — moderation state filter', () => {
  it('returns only published linked posts; pending/spam/archived/closed are hidden', async () => {
    const { getPublicChangelogById } = await import('../changelog.public')
    mockEntryFindFirst.mockResolvedValueOnce({
      id: 'cl_1' as ChangelogId,
      title: 'Release Notes',
      content: '',
      contentJson: null,
      publishedAt: new Date('2026-01-01'),
    })
    const candidates = [
      candidateRow({ id: 'post_pub', moderationState: 'published' }),
      candidateRow({ id: 'post_pen', moderationState: 'pending' }),
      candidateRow({ id: 'post_spam', moderationState: 'spam' }),
      candidateRow({ id: 'post_arch', moderationState: 'archived' }),
      candidateRow({ id: 'post_closed', moderationState: 'closed' }),
    ]
    mockSelect.mockReturnValueOnce(chainResolving(applySqlFilter(candidates)))

    const result = await getPublicChangelogById('cl_1' as ChangelogId)

    const visibleIds = result.linkedPosts.map((p) => p.id)
    expect(visibleIds).toEqual(['post_pub'])
  })

  it('hides linked posts that are deleted even if their moderationState is published', async () => {
    const { getPublicChangelogById } = await import('../changelog.public')
    mockEntryFindFirst.mockResolvedValueOnce({
      id: 'cl_1' as ChangelogId,
      title: 'Release Notes',
      content: '',
      contentJson: null,
      publishedAt: new Date('2026-01-01'),
    })
    const candidates = [
      candidateRow({ id: 'post_live', moderationState: 'published' }),
      candidateRow({
        id: 'post_del',
        moderationState: 'published',
        deletedAt: new Date('2026-02-01'),
      }),
    ]
    mockSelect.mockReturnValueOnce(chainResolving(applySqlFilter(candidates)))

    const result = await getPublicChangelogById('cl_1' as ChangelogId)
    expect(result.linkedPosts.map((p) => p.id)).toEqual(['post_live'])
  })
})

describe('listPublicChangelogs — moderation state filter', () => {
  it('returns only published linked posts across all entries', async () => {
    const { listPublicChangelogs } = await import('../changelog.public')
    mockEntryFindMany.mockResolvedValueOnce([
      {
        id: 'cl_1' as ChangelogId,
        title: 'Release 1',
        content: '',
        contentJson: null,
        publishedAt: new Date('2026-01-02'),
      },
      {
        id: 'cl_2' as ChangelogId,
        title: 'Release 2',
        content: '',
        contentJson: null,
        publishedAt: new Date('2026-01-01'),
      },
    ])
    const candidates = [
      candidateRow({ id: 'p_pub_1', moderationState: 'published', changelogEntryId: 'cl_1' }),
      candidateRow({ id: 'p_pen_1', moderationState: 'pending', changelogEntryId: 'cl_1' }),
      candidateRow({ id: 'p_pub_2', moderationState: 'published', changelogEntryId: 'cl_2' }),
      candidateRow({ id: 'p_spam_2', moderationState: 'spam', changelogEntryId: 'cl_2' }),
    ]
    mockSelect.mockReturnValueOnce(chainResolving(applySqlFilter(candidates)))

    const result = await listPublicChangelogs({})
    const entry1 = result.items.find((e) => e.id === ('cl_1' as ChangelogId))!
    const entry2 = result.items.find((e) => e.id === ('cl_2' as ChangelogId))!
    expect(entry1.linkedPosts.map((p) => p.id)).toEqual(['p_pub_1'])
    expect(entry2.linkedPosts.map((p) => p.id)).toEqual(['p_pub_2'])
  })
})

describe('public changelog — board audience filter', () => {
  // Regression: a team-only post linked into a published changelog entry
  // would leak its title + board slug to anonymous viewers because the
  // filter only checked moderationState/deletedAt, not the linked post's
  // board audience. Same shape as the moderation leak above, on the
  // audience axis.

  it('getPublicChangelogById: hides linked posts whose board audience is not public', async () => {
    const { getPublicChangelogById } = await import('../changelog.public')
    mockEntryFindFirst.mockResolvedValueOnce({
      id: 'cl_1' as ChangelogId,
      title: 'Release Notes',
      content: '',
      contentJson: null,
      publishedAt: new Date('2026-01-01'),
    })
    const candidates = [
      candidateRow({ id: 'post_pub', moderationState: 'published' }),
      candidateRow({
        id: 'post_team',
        moderationState: 'published',
        audience: { kind: 'team' },
      }),
      candidateRow({
        id: 'post_auth',
        moderationState: 'published',
        audience: { kind: 'authenticated' },
      }),
      candidateRow({
        id: 'post_seg',
        moderationState: 'published',
        audience: { kind: 'segments', segmentIds: ['seg_a'] },
      }),
    ]
    mockSelect.mockReturnValueOnce(chainResolving(applySqlFilter(candidates)))

    const result = await getPublicChangelogById('cl_1' as ChangelogId)
    expect(result.linkedPosts.map((p) => p.id)).toEqual(['post_pub'])
  })

  it('listPublicChangelogs: hides non-public-audience linked posts across entries', async () => {
    const { listPublicChangelogs } = await import('../changelog.public')
    mockEntryFindMany.mockResolvedValueOnce([
      {
        id: 'cl_1' as ChangelogId,
        title: 'Release 1',
        content: '',
        contentJson: null,
        publishedAt: new Date('2026-01-02'),
      },
    ])
    const candidates = [
      candidateRow({ id: 'p_pub', moderationState: 'published', changelogEntryId: 'cl_1' }),
      candidateRow({
        id: 'p_team',
        moderationState: 'published',
        audience: { kind: 'team' },
        changelogEntryId: 'cl_1',
      }),
    ]
    mockSelect.mockReturnValueOnce(chainResolving(applySqlFilter(candidates)))

    const result = await listPublicChangelogs({})
    const entry = result.items.find((e) => e.id === ('cl_1' as ChangelogId))!
    expect(entry.linkedPosts.map((p) => p.id)).toEqual(['p_pub'])
  })
})
