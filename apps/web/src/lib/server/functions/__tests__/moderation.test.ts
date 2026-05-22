/**
 * Tests for the moderation server functions.
 *
 * listPendingPostsFn / approvePostFn / rejectPostFn are team-gated:
 * portal users (role='user') get 403, members and admins get through.
 * Both state-mutating fns are guarded pending-only transitions that must
 * emit the corresponding audit event with before/after values intact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ----------------------------------------------------------------------
// createServerFn capture — mirrors the project's existing pattern.
// Use vi.hoisted so the handler-collecting array exists when the mock
// factory runs (mocks are hoisted above imports by vitest).
// ----------------------------------------------------------------------

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({
  handlersByIndex: [] as Handler[],
  mockGetPortalConfig: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: Handler) {
        hoisted.handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

// ----------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------

const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

// In-memory state for the db mock.
type Post = {
  id: string
  moderationState: string
  deletedAt: Date | null
  boardId: string
  principalId: string
  title: string
  content: string
  createdAt: Date
}
type Board = { id: string; name: string }
type Principal = { id: string; displayName: string | null }
const dbState: {
  posts: Post[]
  boards: Board[]
  principals: Principal[]
  auditEvents: Array<Record<string, unknown>>
} = {
  posts: [],
  boards: [],
  principals: [],
  auditEvents: [],
}

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    dbState.auditEvents.push(e)
  }),
  actorFromAuth: vi.fn(
    (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
      userId: auth.user.id,
      email: auth.user.email,
      role: auth.principal.role,
    })
  ),
}))

// Column ref sentinel — same approach as segment-membership tests.
interface ColRef {
  __table: string
  __col: string
}

// Conditions supported by the mock query engine.
type EqCondition = { kind: 'eq'; col: ColRef; val: unknown }
type IsNullCondition = { kind: 'isNull'; col: ColRef }
type AndCondition = { kind: 'and'; conditions: PostCondition[] }
type PostCondition = EqCondition | IsNullCondition | AndCondition

// Resolve a ColRef against a joined row (posts + boards + principal)
type JoinedRow = Post & { __board: Board; __principal: Principal | undefined }

function getVal(row: JoinedRow, col: ColRef): unknown {
  if (col.__table === 'posts') return (row as unknown as Record<string, unknown>)[col.__col]
  if (col.__table === 'boards')
    return (row.__board as unknown as Record<string, unknown>)[col.__col]
  if (col.__table === 'principal')
    return row.__principal
      ? (row.__principal as unknown as Record<string, unknown>)[col.__col]
      : undefined
  return undefined
}

function matchRow(row: JoinedRow, c: PostCondition): boolean {
  if (c.kind === 'eq') return getVal(row, c.col) === c.val
  if (c.kind === 'isNull') {
    const v = getVal(row, c.col)
    return v === null || v === undefined
  }
  if (c.kind === 'and') return c.conditions.every((sub) => matchRow(row, sub))
  return false
}

// The select query mock builds a fluent chain:
// select({...}).from(posts).innerJoin(boards, ...).leftJoin(principal, ...).where(...).orderBy(...)
// We capture the projection spec and resolve it at orderBy() time.
type ProjectionSpec = Record<string, ColRef>

function buildSelectChain(
  spec: ProjectionSpec,
  joinedRows: JoinedRow[] | null,
  cond: PostCondition | null
) {
  const resolve = () => {
    const rows = joinedRows ?? []
    const filtered = cond ? rows.filter((r) => matchRow(r, cond)) : rows
    return filtered.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [key, col] of Object.entries(spec)) {
        out[key] = getVal(r, col)
      }
      return out
    })
  }
  return {
    orderBy: vi.fn(() => Promise.resolve(resolve())),
    where: vi.fn((c: PostCondition) => buildSelectChain(spec, joinedRows, c)),
  }
}

function buildJoinChain(spec: ProjectionSpec, rows: JoinedRow[]) {
  const chain: Record<string, unknown> = {}

  chain.innerJoin = vi.fn((_table: unknown, _on: unknown) => {
    // Filter to rows that have a matching board
    const withBoards = rows.flatMap((r) => {
      const board = dbState.boards.find((b) => b.id === r.boardId)
      return board ? [{ ...r, __board: board }] : []
    })
    return buildJoinChain(spec, withBoards)
  })

  chain.leftJoin = vi.fn((_table: unknown, _on: unknown) => {
    // Left-join: always keep all rows, enrich with principal when found
    const enriched = rows.map((r) => ({
      ...r,
      __principal: dbState.principals.find((p) => p.id === r.principalId),
    }))
    return buildJoinChain(spec, enriched)
  })

  chain.where = vi.fn((c: PostCondition) => buildSelectChain(spec, rows, c))

  return chain as {
    innerJoin: ReturnType<typeof vi.fn>
    leftJoin: ReturnType<typeof vi.fn>
    where: ReturnType<typeof vi.fn>
  }
}

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: (...args: unknown[]) => hoisted.mockGetPortalConfig(...args),
  updatePortalConfig: vi.fn(),
  getPublicPortalConfig: vi.fn(),
  getPublicAuthConfig: vi.fn(),
  getDeveloperConfig: vi.fn(),
  updateDeveloperConfig: vi.fn(),
}))

const mockAnnouncePublishedPost = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/posts/post.announce', () => ({
  announcePublishedPost: (...args: unknown[]) => mockAnnouncePublishedPost(...args),
}))

const mockGetPortalConfig = hoisted.mockGetPortalConfig

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn((spec: ProjectionSpec) => ({
      from: vi.fn((_table: unknown) => {
        const baseRows: JoinedRow[] = dbState.posts.map((p) => ({
          ...p,
          __board: dbState.boards.find((b) => b.id === p.boardId) ?? { id: '', name: '' },
          __principal: dbState.principals.find((pr) => pr.id === p.principalId),
        }))
        return buildJoinChain(spec, baseRows)
      }),
    })),
    query: {
      posts: {
        findFirst: vi.fn(async (args: { where: PostCondition }) => {
          const rows: JoinedRow[] = dbState.posts.map((p) => ({
            ...p,
            __board: { id: '', name: '' },
            __principal: undefined,
          }))
          return rows.find((r) => matchRow(r, args.where))
        }),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((patch: Partial<Post>) => ({
        where: vi.fn((cond: PostCondition) => ({
          returning: vi.fn(() => {
            const rows: JoinedRow[] = dbState.posts.map((p) => ({
              ...p,
              __board: { id: '', name: '' },
              __principal: undefined,
            }))
            const matched = rows.filter((r) => matchRow(r, cond))
            dbState.posts = dbState.posts.map((p) => {
              const r: JoinedRow = { ...p, __board: { id: '', name: '' }, __principal: undefined }
              return matchRow(r, cond) ? { ...p, ...patch } : p
            })
            return Promise.resolve(matched.map((p) => ({ id: p.id })))
          }),
        })),
      })),
    })),
  },
  posts: {
    id: { __table: 'posts', __col: 'id' } satisfies ColRef,
    moderationState: { __table: 'posts', __col: 'moderationState' } satisfies ColRef,
    deletedAt: { __table: 'posts', __col: 'deletedAt' } satisfies ColRef,
    boardId: { __table: 'posts', __col: 'boardId' } satisfies ColRef,
    principalId: { __table: 'posts', __col: 'principalId' } satisfies ColRef,
    title: { __table: 'posts', __col: 'title' } satisfies ColRef,
    content: { __table: 'posts', __col: 'content' } satisfies ColRef,
    createdAt: { __table: 'posts', __col: 'createdAt' } satisfies ColRef,
  },
  boards: {
    id: { __table: 'boards', __col: 'id' } satisfies ColRef,
    name: { __table: 'boards', __col: 'name' } satisfies ColRef,
    deletedAt: { __table: 'boards', __col: 'deletedAt' } satisfies ColRef,
  },
  principal: {
    id: { __table: 'principal', __col: 'id' } satisfies ColRef,
    displayName: { __table: 'principal', __col: 'displayName' } satisfies ColRef,
  },
  eq: vi.fn(
    (col: ColRef, val: unknown): EqCondition => ({
      kind: 'eq',
      col,
      val,
    })
  ),
  and: vi.fn((...conditions: PostCondition[]): AndCondition => ({ kind: 'and', conditions })),
  isNull: vi.fn((col: ColRef): IsNullCondition => ({ kind: 'isNull', col })),
  desc: vi.fn((col: ColRef) => col),
  sql: vi.fn(),
}))

import { ForbiddenError, NotFoundError, ConflictError } from '@/lib/shared/errors'

// Indexes correspond to declaration order in moderation.ts:
// 0=listPending, 1=approve, 2=reject, 3=getModerationStatus
function listPending(): Handler {
  return hoisted.handlersByIndex[0]
}
function approve(): Handler {
  return hoisted.handlersByIndex[1]
}
function reject(): Handler {
  return hoisted.handlersByIndex[2]
}
function getModerationStatusHandler(): Handler {
  return hoisted.handlersByIndex[3]
}

// Import after mocks so handlers are captured.
import '../moderation'

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

const AUTH_ADMIN = {
  user: { id: 'user_admin', email: 'admin@x' },
  principal: { id: 'p_admin', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}
const AUTH_MEMBER = {
  ...AUTH_ADMIN,
  principal: { ...AUTH_ADMIN.principal, role: 'member' as const },
}
const AUTH_USER = { ...AUTH_ADMIN, principal: { ...AUTH_ADMIN.principal, role: 'user' as const } }

// Default extra fields for posts used by approve/reject tests (not exercised by those tests)
const POST_DEFAULTS = {
  boardId: 'b1',
  principalId: 'pr1',
  title: 'T',
  content: 'C',
  createdAt: new Date('2024-01-01'),
}

beforeEach(() => {
  dbState.posts = []
  dbState.boards = []
  dbState.principals = []
  dbState.auditEvents = []
  mockRequireAuth.mockReset()
  mockGetPortalConfig.mockReset()
  mockAnnouncePublishedPost.mockReset()
  mockAnnouncePublishedPost.mockResolvedValue(undefined)
})

// ----------------------------------------------------------------------
// listPendingPostsFn
// ----------------------------------------------------------------------

describe('listPendingPostsFn — role gating', () => {
  it('propagates requireAuth rejection (unauthenticated → 401-shaped error)', async () => {
    // requireAuth is the gate that turns missing/expired sessions into a
    // typed error. The handler must not swallow that — if it did, the
    // role-check below would see undefined and crash, exposing a stack
    // trace instead of a structured 401.
    const authError = new Error('UNAUTHORIZED: session expired')
    mockRequireAuth.mockRejectedValue(authError)
    await expect(listPending()({ data: {} })).rejects.toBe(authError)
  })

  it('rejects role=user with ForbiddenError', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_USER)
    await expect(listPending()({ data: {} })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin sees all pending', async () => {
    dbState.boards = [{ id: 'b1', name: 'Ideas' }]
    dbState.principals = [{ id: 'pr1', displayName: 'Alice' }]
    dbState.posts = [
      { ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null },
      { ...POST_DEFAULTS, id: 'p2', moderationState: 'published', deletedAt: null },
      { ...POST_DEFAULTS, id: 'p3', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPending()({ data: {} })) as { posts: Array<{ id: string }> }
    // Only the two pending posts are returned (published is excluded by query filter)
    expect(result.posts).toHaveLength(2)
    expect(result.posts.map((p) => p.id).sort()).toEqual(['p1', 'p3'])
  })

  it('member also sees pending (moderation is a team activity)', async () => {
    dbState.boards = [{ id: 'b1', name: 'Ideas' }]
    dbState.principals = [{ id: 'pr1', displayName: 'Alice' }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    const result = (await listPending()({ data: {} })) as { posts: Post[] }
    expect(result.posts).toHaveLength(1)
  })

  it('returns empty when nothing is pending', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPending()({ data: {} })) as { posts: Post[] }
    expect(result.posts).toEqual([])
  })
})

// ----------------------------------------------------------------------
// approvePostFn
// ----------------------------------------------------------------------

describe('approvePostFn', () => {
  it('propagates requireAuth rejection', async () => {
    const authError = new Error('UNAUTHORIZED')
    mockRequireAuth.mockRejectedValue(authError)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBe(authError)
  })

  it('rejects role=user', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_USER)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns NotFoundError when post does not exist', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approve()({ data: { postId: 'missing' } })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('flips moderationState pending → published', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await approve()({ data: { postId: 'p1' } })
    expect(dbState.posts[0].moderationState).toBe('published')
  })

  it('records an audit row with before/after state', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await approve()({ data: { postId: 'p1' } })
    const event = dbState.auditEvents.find((e) => e.event === 'post.moderation.approved')
    expect(event).toBeDefined()
    expect(event!.before).toEqual({ moderationState: 'pending' })
    expect(event!.after).toEqual({ moderationState: 'published' })
    expect((event!.target as { id: string }).id).toBe('p1')
  })

  it('throws ConflictError when approving an already-published post', async () => {
    // Race between two moderators: the second approve must be rejected,
    // not silently re-applied, so the audit log stays clean.
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
  })

  it('throws ConflictError and does not publish a soft-deleted (rejected) post', async () => {
    // Approve on a post that is pending but already soft-deleted (reject was called first).
    // The WHERE clause must include isNull(deletedAt) so that ghost-publishing is blocked.
    dbState.posts = [
      {
        ...POST_DEFAULTS,
        id: 'p1',
        moderationState: 'pending',
        deletedAt: new Date('2024-06-01'),
      },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
    // The post must NOT have been flipped to published.
    expect(dbState.posts[0].moderationState).toBe('pending')
  })

  it('member can approve', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    await approve()({ data: { postId: 'p1' } })
    expect(dbState.posts[0].moderationState).toBe('published')
  })

  it('calls announcePublishedPost with the postId on successful approve', async () => {
    // The deferred announcement (webhooks, @-mentions) must fire after approve,
    // not at create time when the post was held for moderation.
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await approve()({ data: { postId: 'p1' } })
    expect(mockAnnouncePublishedPost).toHaveBeenCalledOnce()
    expect(mockAnnouncePublishedPost).toHaveBeenCalledWith('p1')
  })

  it('does NOT call announcePublishedPost when approve fails (already published)', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
    expect(mockAnnouncePublishedPost).not.toHaveBeenCalled()
  })
})

// ----------------------------------------------------------------------
// rejectPostFn
// ----------------------------------------------------------------------

describe('rejectPostFn', () => {
  it('propagates requireAuth rejection', async () => {
    const authError = new Error('UNAUTHORIZED')
    mockRequireAuth.mockRejectedValue(authError)
    await expect(reject()({ data: { postId: 'p1' } })).rejects.toBe(authError)
  })

  it('rejects role=user', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_USER)
    await expect(reject()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns NotFoundError for missing post', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(reject()({ data: { postId: 'nope' } })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('soft-deletes (sets deletedAt) instead of flipping moderationState to spam', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await reject()({ data: { postId: 'p1' } })
    const post = dbState.posts[0]
    expect(post.deletedAt).toBeInstanceOf(Date)
    // moderationState stays 'pending' — restoring returns the post to the queue
    expect(post.moderationState).toBe('pending')
  })

  it('records reason in audit metadata when supplied', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await reject()({ data: { postId: 'p1', reason: 'link spam' } })
    const event = dbState.auditEvents.find((e) => e.event === 'post.moderation.rejected')
    expect(event!.metadata).toEqual({ reason: 'link spam' })
  })

  it('omits reason (null) when not supplied', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await reject()({ data: { postId: 'p1' } })
    const event = dbState.auditEvents.find((e) => e.event === 'post.moderation.rejected')
    expect(event!.metadata).toEqual({ reason: null })
  })

  it('throws ConflictError when rejecting a non-pending post', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(reject()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
  })

  it('member can reject', async () => {
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    await reject()({ data: { postId: 'p1' } })
    expect(dbState.posts[0].deletedAt).toBeInstanceOf(Date)
  })
})

// ----------------------------------------------------------------------
// listPendingPostsFn — soft-delete exclusion + enrichment
// ----------------------------------------------------------------------

describe('listPendingPostsFn — listPendingPosts exclusion + enrichment', () => {
  it('excludes a post that is pending but has deletedAt set (rejected)', async () => {
    dbState.boards = [{ id: 'b1', name: 'Ideas' }]
    dbState.principals = [{ id: 'pr1', displayName: 'Alice' }]
    dbState.posts = [
      { ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null },
      {
        ...POST_DEFAULTS,
        id: 'p2',
        moderationState: 'pending',
        deletedAt: new Date('2024-06-01'),
      },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPending()({ data: {} })) as {
      posts: Array<{ id: string }>
    }
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0].id).toBe('p1')
  })

  it('each returned row carries boardName and authorName', async () => {
    dbState.boards = [{ id: 'b1', name: 'Feature Requests' }]
    dbState.principals = [{ id: 'pr1', displayName: 'Bob' }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPending()({ data: {} })) as {
      posts: Array<{ id: string; boardName: string; authorName: string | null }>
    }
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0].boardName).toBe('Feature Requests')
    expect(result.posts[0].authorName).toBe('Bob')
  })

  it('authorName is null when principal has no displayName', async () => {
    dbState.boards = [{ id: 'b1', name: 'Ideas' }]
    dbState.principals = [{ id: 'pr1', displayName: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPending()({ data: {} })) as {
      posts: Array<{ id: string; authorName: string | null }>
    }
    expect(result.posts[0].authorName).toBeNull()
  })
})

// ----------------------------------------------------------------------
// getModerationStatus
// ----------------------------------------------------------------------

// Helper: build a db.select mock that returns the pending count. This is the
// only select getModerationStatus runs — `enabled` derives purely from the
// workspace moderation policy.
import { db } from '@/lib/server/db'

function stubSelectCalls(pendingCount: number) {
  const countChain = {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ count: pendingCount }])),
    })),
  }
  vi.mocked(db.select).mockImplementationOnce(() => countChain as never)
}

describe('getModerationStatus', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
  })

  it('propagates requireAuth rejection (unauthenticated)', async () => {
    const authError = new Error('UNAUTHORIZED')
    mockRequireAuth.mockRejectedValue(authError)
    await expect(getModerationStatusHandler()({ data: {} })).rejects.toBe(authError)
  })

  it('rejects role=user with ForbiddenError', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_USER)
    await expect(getModerationStatusHandler()({ data: {} })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pendingCount reflects count of pending + non-deleted posts', async () => {
    stubSelectCalls(7)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'none' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.pendingCount).toBe(7)
  })

  it('enabled=true when the workspace moderation policy is not none', async () => {
    stubSelectCalls(0)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'all' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.enabled).toBe(true)
  })

  it('enabled=false when the workspace moderation policy is none', async () => {
    stubSelectCalls(0)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'none' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.enabled).toBe(false)
  })

  it('enabled=true for a partial gating policy (anonymous), pendingCount passes through', async () => {
    stubSelectCalls(3)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'anonymous' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.enabled).toBe(true)
    expect(result.pendingCount).toBe(3)
  })
})
