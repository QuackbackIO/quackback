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
const hoisted = vi.hoisted(() => ({ handlersByIndex: [] as Handler[] }))

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
type Post = { id: string; moderationState: string; deletedAt: Date | null }
const dbState: { posts: Post[]; auditEvents: Array<Record<string, unknown>> } = {
  posts: [],
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
interface PostsColumn {
  __col: keyof Post
}

// Conditions supported by the mock query engine.
type EqCondition = { kind: 'eq'; col: keyof Post; val: string }
type IsNullCondition = { kind: 'isNull'; col: keyof Post }
type AndCondition = { kind: 'and'; conditions: PostCondition[] }
type PostCondition = EqCondition | IsNullCondition | AndCondition

function matchPost(post: Post, c: PostCondition): boolean {
  if (c.kind === 'eq') return post[c.col] === c.val
  if (c.kind === 'isNull') return post[c.col] === null || post[c.col] === undefined
  if (c.kind === 'and') return c.conditions.every((sub) => matchPost(post, sub))
  return false
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (cond: PostCondition) =>
          dbState.posts.filter((p) => matchPost(p, cond))
        ),
      })),
    })),
    query: {
      posts: {
        findFirst: vi.fn(async (args: { where: PostCondition }) => {
          return dbState.posts.find((p) => matchPost(p, args.where))
        }),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((patch: Partial<Post>) => ({
        where: vi.fn((cond: PostCondition) => ({
          returning: vi.fn(() => {
            const matched = dbState.posts.filter((p) => matchPost(p, cond))
            dbState.posts = dbState.posts.map((p) => (matchPost(p, cond) ? { ...p, ...patch } : p))
            return Promise.resolve(matched.map((p) => ({ id: p.id })))
          }),
        })),
      })),
    })),
  },
  posts: {
    id: { __col: 'id' } satisfies PostsColumn,
    moderationState: { __col: 'moderationState' } satisfies PostsColumn,
    deletedAt: { __col: 'deletedAt' } satisfies PostsColumn,
  },
  eq: vi.fn(
    (col: PostsColumn, val: string): EqCondition => ({
      kind: 'eq',
      col: col.__col,
      val,
    })
  ),
  and: vi.fn((...conditions: PostCondition[]): AndCondition => ({ kind: 'and', conditions })),
  isNull: vi.fn((col: PostsColumn): IsNullCondition => ({ kind: 'isNull', col: col.__col })),
}))

import { ForbiddenError, NotFoundError, ConflictError } from '@/lib/shared/errors'

// Indexes correspond to declaration order in moderation.ts:
// 0=listPending, 1=approve, 2=reject
function listPending(): Handler {
  return hoisted.handlersByIndex[0]
}
function approve(): Handler {
  return hoisted.handlersByIndex[1]
}
function reject(): Handler {
  return hoisted.handlersByIndex[2]
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

beforeEach(() => {
  dbState.posts = []
  dbState.auditEvents = []
  mockRequireAuth.mockReset()
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
    dbState.posts = [
      { id: 'p1', moderationState: 'pending', deletedAt: null },
      { id: 'p2', moderationState: 'published', deletedAt: null },
      { id: 'p3', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPending()({ data: {} })) as { posts: Post[] }
    expect(result.posts).toHaveLength(2)
    expect(result.posts.every((p) => p.moderationState === 'pending')).toBe(true)
  })

  it('member also sees pending (moderation is a team activity)', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
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
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await approve()({ data: { postId: 'p1' } })
    expect(dbState.posts[0].moderationState).toBe('published')
  })

  it('records an audit row with before/after state', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
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
    dbState.posts = [{ id: 'p1', moderationState: 'published', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
  })

  it('member can approve', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    await approve()({ data: { postId: 'p1' } })
    expect(dbState.posts[0].moderationState).toBe('published')
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
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await reject()({ data: { postId: 'p1' } })
    const post = dbState.posts[0]
    expect(post.deletedAt).toBeInstanceOf(Date)
    // moderationState stays 'pending' — restoring returns the post to the queue
    expect(post.moderationState).toBe('pending')
  })

  it('records reason in audit metadata when supplied', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await reject()({ data: { postId: 'p1', reason: 'link spam' } })
    const event = dbState.auditEvents.find((e) => e.event === 'post.moderation.rejected')
    expect(event!.metadata).toEqual({ reason: 'link spam' })
  })

  it('omits reason (null) when not supplied', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await reject()({ data: { postId: 'p1' } })
    const event = dbState.auditEvents.find((e) => e.event === 'post.moderation.rejected')
    expect(event!.metadata).toEqual({ reason: null })
  })

  it('throws ConflictError when rejecting a non-pending post', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'published', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(reject()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
  })

  it('member can reject', async () => {
    dbState.posts = [{ id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    await reject()({ data: { postId: 'p1' } })
    expect(dbState.posts[0].deletedAt).toBeInstanceOf(Date)
  })
})
