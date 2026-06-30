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
  logSpies: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.logSpies, child })
  return {
    logger: { ...hoisted.logSpies, child },
    createLogger: () => ({ ...hoisted.logSpies, child }),
  }
})

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
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

// Stub the server-runtime header reader. moderation.ts calls
// getRequestHeaders() to populate audit observability columns; outside
// the StartEvent AsyncLocalStorage scope it throws, so return an empty
// Headers in tests.
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
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
type Board = { id: string; name: string; deletedAt?: Date | null }
type Principal = { id: string; displayName: string | null }
// Comment rows for the comment-moderation mutation paths. Optional so existing
// post-only tests don't have to initialize the comments slot.
type Comment = {
  id: string
  postId: string
  moderationState: string
  deletedAt: Date | null
  principalId: string
  content: string
  createdAt: Date
}
const dbState: {
  posts: Post[]
  boards: Board[]
  principals: Principal[]
  comments: Comment[]
  auditEvents: Array<Record<string, unknown>>
} = {
  posts: [],
  boards: [],
  principals: [],
  comments: [],
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
// eq can also be a column-to-column comparison (used inside EXISTS subqueries
// to correlate outer/inner rows, e.g. eq(boards.id, posts.boardId)).
type EqColCondition = { kind: 'eqCol'; left: ColRef; right: ColRef }
type IsNullCondition = { kind: 'isNull'; col: ColRef }
type AndCondition = { kind: 'and'; conditions: PostCondition[] }
type ExistsCondition = { kind: 'exists'; subquery: SubqueryDescriptor }
type PostCondition = EqCondition | EqColCondition | IsNullCondition | AndCondition | ExistsCondition

// A subquery captured by the mocked select chain — carries the source table
// and the WHERE condition so EXISTS can evaluate it against the outer row.
type SubqueryDescriptor = { __subquery: true; from: string; cond: PostCondition | null }

// A row context is a merged map of table-name → row data. EXISTS subqueries
// extend the outer context with inner rows so correlated column refs resolve.
type RowContext = {
  posts?: Post
  boards?: Board
  principal?: Principal
  comments?: Comment
}

// Resolve a ColRef against a row context (any subset of tables present).
function getVal(ctx: RowContext, col: ColRef): unknown {
  const table = ctx[col.__table as keyof RowContext] as Record<string, unknown> | undefined
  return table ? table[col.__col] : undefined
}

// Pick from in-memory state by table name. Used by EXISTS to iterate rows.
function rowsFor(table: string): Array<Record<string, unknown>> {
  if (table === 'posts') return dbState.posts as unknown as Array<Record<string, unknown>>
  if (table === 'boards') return dbState.boards as unknown as Array<Record<string, unknown>>
  if (table === 'comments') return dbState.comments as unknown as Array<Record<string, unknown>>
  if (table === 'principal') return dbState.principals as unknown as Array<Record<string, unknown>>
  return []
}

function matchRow(ctx: RowContext, c: PostCondition): boolean {
  if (c.kind === 'eq') return getVal(ctx, c.col) === c.val
  if (c.kind === 'eqCol') return getVal(ctx, c.left) === getVal(ctx, c.right)
  if (c.kind === 'isNull') {
    const v = getVal(ctx, c.col)
    return v === null || v === undefined
  }
  if (c.kind === 'and') return c.conditions.every((sub) => matchRow(ctx, sub))
  if (c.kind === 'exists') {
    const inner = rowsFor(c.subquery.from)
    return inner.some((row) => {
      const innerCtx: RowContext = {
        ...ctx,
        [c.subquery.from]: row,
      } as RowContext
      return c.subquery.cond === null ? true : matchRow(innerCtx, c.subquery.cond)
    })
  }
  return false
}

// Legacy adapter — older tests pass JoinedRow shapes to the mock's update path.
// Translate the joined-row into a RowContext.
type JoinedRow = Post & { __board: Board; __principal: Principal | undefined }
function ctxFromJoined(row: JoinedRow): RowContext {
  return {
    posts: row as unknown as Post,
    boards: row.__board,
    principal: row.__principal,
  }
}

// The select query mock builds a fluent chain:
// select({...}).from(posts).innerJoin(boards, ...).leftJoin(principal, ...).where(...).orderBy(...)
// We capture the projection spec and resolve it at orderBy() time.
type ProjectionSpec = Record<string, ColRef>

function buildSelectChain(
  spec: ProjectionSpec,
  joinedRows: JoinedRow[] | null,
  cond: PostCondition | null,
  fromTable: string | null
) {
  const resolve = () => {
    const rows = joinedRows ?? []
    const filtered = cond ? rows.filter((r) => matchRow(ctxFromJoined(r), cond)) : rows
    return filtered.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [key, col] of Object.entries(spec)) {
        out[key] = getVal(ctxFromJoined(r), col)
      }
      return out
    })
  }
  // Carry __subquery metadata so exists() can lift this chain into an
  // ExistsCondition without needing the inner cond evaluated yet.
  const subqueryMarker: SubqueryDescriptor | null = fromTable
    ? { __subquery: true, from: fromTable, cond }
    : null
  return {
    orderBy: vi.fn(() => Promise.resolve(resolve())),
    where: vi.fn((c: PostCondition) => buildSelectChain(spec, joinedRows, c, fromTable)),
    __subquery: subqueryMarker,
  }
}

function buildJoinChain(spec: ProjectionSpec, rows: JoinedRow[], fromTable: string | null) {
  const chain: Record<string, unknown> = {}

  chain.innerJoin = vi.fn((_table: unknown, _on: unknown) => {
    // Filter to rows that have a matching board
    const withBoards = rows.flatMap((r) => {
      const board = dbState.boards.find((b) => b.id === r.boardId)
      return board ? [{ ...r, __board: board }] : []
    })
    return buildJoinChain(spec, withBoards, fromTable)
  })

  chain.leftJoin = vi.fn((_table: unknown, _on: unknown) => {
    // Left-join: always keep all rows, enrich with principal when found
    const enriched = rows.map((r) => ({
      ...r,
      __principal: dbState.principals.find((p) => p.id === r.principalId),
    }))
    return buildJoinChain(spec, enriched, fromTable)
  })

  chain.where = vi.fn((c: PostCondition) => buildSelectChain(spec, rows, c, fromTable))

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

const mockAnnouncePublishedComment = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/comments/comment.announce', () => ({
  announcePublishedComment: (...args: unknown[]) => mockAnnouncePublishedComment(...args),
}))

const mockGetPortalConfig = hoisted.mockGetPortalConfig

// Production code passes the ColRef containers (`posts`/`comments`/`boards`)
// to `.from()` and `.update()`. Each container is tagged with a __tableName
// (see the table mocks below) so the mock can dispatch on identity.
function tableNameOf(t: unknown): string {
  if (t && typeof t === 'object' && '__tableName' in t) {
    return (t as { __tableName: string }).__tableName
  }
  return ''
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn((spec: ProjectionSpec) => ({
      from: vi.fn((table: unknown) => {
        const fromName = tableNameOf(table)
        // The listPending* queries always start from posts (or comments) and
        // join through boards. For the post path we materialise post-joined
        // rows for backward compatibility with the existing list-query tests.
        // For subqueries used inside EXISTS, .from(boards) / .from(posts)
        // returns a chain that resolves via the __subquery descriptor — the
        // joined rows are unused (no enrichment needed for an EXISTS check).
        if (fromName === 'posts') {
          const baseRows: JoinedRow[] = dbState.posts.map((p) => ({
            ...p,
            __board: dbState.boards.find((b) => b.id === p.boardId) ?? { id: '', name: '' },
            __principal: dbState.principals.find((pr) => pr.id === p.principalId),
          }))
          return buildJoinChain(spec, baseRows, fromName)
        }
        if (fromName === 'comments') {
          // For the comments list path we synthesise joined rows where the
          // outer Post fields are filled from the comment's parent post so
          // the projection spec (which references posts.title / boards.name)
          // resolves cleanly.
          const baseRows: JoinedRow[] = dbState.comments.map((c) => {
            const parentPost = dbState.posts.find((p) => p.id === c.postId)
            const parentBoard = parentPost
              ? dbState.boards.find((b) => b.id === parentPost.boardId)
              : undefined
            // The list-comments tests aren't part of this fix, so a minimal
            // synthesis here is fine — what matters for EXISTS evaluation is
            // that dbState.comments is the source of truth.
            return {
              ...(parentPost ?? ({} as Post)),
              ...c,
              __board: parentBoard ?? { id: '', name: '' },
              __principal: dbState.principals.find((pr) => pr.id === c.principalId),
            } as JoinedRow
          })
          return buildJoinChain(spec, baseRows, fromName)
        }
        // Default fallback for `from(boards)` subqueries etc — no joined
        // rows needed; the chain only carries the __subquery descriptor.
        return buildJoinChain(spec, [], fromName)
      }),
    })),
    query: {
      posts: {
        findFirst: vi.fn(async (args: { where: PostCondition }) => {
          return dbState.posts.find((p) => matchRow({ posts: p }, args.where))
        }),
      },
      comments: {
        findFirst: vi.fn(async (args: { where: PostCondition }) => {
          return dbState.comments.find((c) => matchRow({ comments: c }, args.where))
        }),
      },
    },
    update: vi.fn((table: unknown) => {
      const targetName = tableNameOf(table)
      return {
        set: vi.fn((patch: Partial<Post> | Partial<Comment>) => ({
          where: vi.fn((cond: PostCondition) => ({
            returning: vi.fn(() => {
              if (targetName === 'comments') {
                const matched: Comment[] = []
                dbState.comments = dbState.comments.map((c) => {
                  if (matchRow({ comments: c }, cond)) {
                    matched.push(c)
                    return { ...c, ...(patch as Partial<Comment>) }
                  }
                  return c
                })
                return Promise.resolve(
                  matched.map((c) => ({
                    id: c.id,
                    postId: c.postId,
                    isPrivate: (c as Comment & { isPrivate?: boolean }).isPrivate,
                  }))
                )
              }
              // Default: posts. Build a minimal context that carries the
              // post row so the EXISTS subqueries can correlate on
              // posts.boardId etc.
              const matched: Post[] = []
              dbState.posts = dbState.posts.map((p) => {
                if (matchRow({ posts: p }, cond)) {
                  matched.push(p)
                  return { ...p, ...(patch as Partial<Post>) }
                }
                return p
              })
              return Promise.resolve(matched.map((p) => ({ id: p.id })))
            }),
          })),
        })),
      }
    }),
    // approveCommentFn wraps the publish + count increment in a transaction.
    // The tx is the same mocked db, so tests that wrap db.update still observe
    // both writes.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const mod = (await import('@/lib/server/db')) as { db: unknown }
      return fn(mod.db)
    }),
  },
  // Table mocks: carry the column refs PLUS a __tableName tag so the
  // production code's `.from(posts)` / `.update(posts)` can resolve table
  // identity without inspecting Drizzle internals.
  posts: {
    __tableName: 'posts',
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
    __tableName: 'boards',
    id: { __table: 'boards', __col: 'id' } satisfies ColRef,
    name: { __table: 'boards', __col: 'name' } satisfies ColRef,
    slug: { __table: 'boards', __col: 'slug' } satisfies ColRef,
    deletedAt: { __table: 'boards', __col: 'deletedAt' } satisfies ColRef,
  },
  comments: {
    __tableName: 'comments',
    id: { __table: 'comments', __col: 'id' } satisfies ColRef,
    moderationState: { __table: 'comments', __col: 'moderationState' } satisfies ColRef,
    deletedAt: { __table: 'comments', __col: 'deletedAt' } satisfies ColRef,
    postId: { __table: 'comments', __col: 'postId' } satisfies ColRef,
    principalId: { __table: 'comments', __col: 'principalId' } satisfies ColRef,
    content: { __table: 'comments', __col: 'content' } satisfies ColRef,
    createdAt: { __table: 'comments', __col: 'createdAt' } satisfies ColRef,
  },
  principal: {
    __tableName: 'principal',
    id: { __table: 'principal', __col: 'id' } satisfies ColRef,
    displayName: { __table: 'principal', __col: 'displayName' } satisfies ColRef,
  },
  // eq: supports both column-to-literal (the common case) and
  // column-to-column (correlated EXISTS subqueries).
  eq: vi.fn((col: ColRef, val: unknown): EqCondition | EqColCondition => {
    if (val && typeof val === 'object' && '__table' in val && '__col' in val) {
      return { kind: 'eqCol', left: col, right: val as ColRef }
    }
    return { kind: 'eq', col, val }
  }),
  and: vi.fn((...conditions: PostCondition[]): AndCondition => ({ kind: 'and', conditions })),
  // The approval-count query uses or(...) over two JSONB-extract sql tags; the
  // helper-chain test doubles short-circuit before any condition is evaluated,
  // so a passthrough that returns the args is enough to satisfy the import.
  or: vi.fn((...conditions: PostCondition[]) => ({ kind: 'or', conditions })),
  isNull: vi.fn((col: ColRef): IsNullCondition => ({ kind: 'isNull', col })),
  exists: vi.fn((subqueryChain: { __subquery: SubqueryDescriptor | null }): ExistsCondition => {
    // The select chain stashes its from-table + final WHERE on
    // __subquery; if absent (e.g. a bare select without .from().where())
    // the EXISTS check is vacuously true (matches PostgreSQL semantics
    // for an empty subquery shape — though we'd never hit this in this
    // codebase).
    if (!subqueryChain.__subquery) {
      throw new Error('exists() called without a subquery descriptor')
    }
    return { kind: 'exists', subquery: subqueryChain.__subquery }
  }),
  desc: vi.fn((col: ColRef) => col),
  sql: vi.fn(),
}))

import { NotFoundError, ConflictError } from '@/lib/shared/errors'

// Indexes correspond to declaration order in moderation.ts:
// 0=listPendingPosts, 1=listPendingComments, 2=approve, 3=approveComment, 4=rejectComment, 5=reject, 6=getModerationStatus
function listPendingPosts(): Handler {
  return hoisted.handlersByIndex[0]
}
// Index slot 1 (listPendingComments) is intentionally not accessed here —
// each accessor hardcodes its own index, so skipping it leaves the others
// correct.
function approve(): Handler {
  return hoisted.handlersByIndex[2]
}
function approveComment(): Handler {
  return hoisted.handlersByIndex[3]
}
function rejectComment(): Handler {
  return hoisted.handlersByIndex[4]
}
function reject(): Handler {
  return hoisted.handlersByIndex[5]
}
function getModerationStatusHandler(): Handler {
  return hoisted.handlersByIndex[6]
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
  // Seed the default board referenced by POST_DEFAULTS.boardId so the
  // approve/reject TOCTOU EXISTS subqueries (which require an undeleted
  // parent board) succeed for the bulk of tests. Tests that need a
  // soft-deleted board override dbState.boards explicitly.
  dbState.boards = [{ id: 'b1', name: 'Default', deletedAt: null }]
  dbState.principals = []
  dbState.comments = []
  dbState.auditEvents = []
  mockRequireAuth.mockReset()
  mockGetPortalConfig.mockReset()
  mockAnnouncePublishedPost.mockReset()
  mockAnnouncePublishedPost.mockResolvedValue(undefined)
  mockAnnouncePublishedComment.mockReset()
  mockAnnouncePublishedComment.mockResolvedValue(undefined)
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
    await expect(listPendingPosts()({ data: {} })).rejects.toBe(authError)
  })

  it('rejects role=user with ForbiddenError', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listPendingPosts()({ data: {} })).rejects.toThrow('Access denied')
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
    const result = (await listPendingPosts()({ data: {} })) as { posts: Array<{ id: string }> }
    // Only the two pending posts are returned (published is excluded by query filter)
    expect(result.posts).toHaveLength(2)
    expect(result.posts.map((p) => p.id).sort()).toEqual(['p1', 'p3'])
  })

  it('member also sees pending (moderation is a team activity)', async () => {
    dbState.boards = [{ id: 'b1', name: 'Ideas' }]
    dbState.principals = [{ id: 'pr1', displayName: 'Alice' }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    const result = (await listPendingPosts()({ data: {} })) as { posts: Post[] }
    expect(result.posts).toHaveLength(1)
  })

  it('returns empty when nothing is pending', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPendingPosts()({ data: {} })) as { posts: Post[] }
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
    mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toThrow('Access denied')
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
    mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(reject()({ data: { postId: 'p1' } })).rejects.toThrow('Access denied')
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
// TOCTOU guards on the four mutation handlers
//
// The list/count queries filter through parent .deletedAt (board for posts,
// post+board for comments). The guarded UPDATE WHERE clauses must apply
// the same filter, otherwise a stale moderation queue can mutate items
// whose parent has been soft-deleted between display and click.
// ----------------------------------------------------------------------

describe('mutation TOCTOU guards — parent-deletedAt in the UPDATE WHERE', () => {
  const COMMENT_DEFAULTS = {
    postId: 'p1',
    principalId: 'pr1',
    content: 'C',
    createdAt: new Date('2024-01-01'),
  }

  it('approvePostFn refuses to publish when the parent board is soft-deleted', async () => {
    dbState.boards = [{ id: 'b1', name: 'Archived', deletedAt: new Date('2024-06-01') }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approve()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
    // The post must NOT have flipped to published — the EXISTS guard fires
    // the same POST_NOT_PENDING semantic the moderator's queue uses.
    expect(dbState.posts[0].moderationState).toBe('pending')
  })

  it('rejectPostFn refuses to soft-delete when the parent board is soft-deleted', async () => {
    dbState.boards = [{ id: 'b1', name: 'Archived', deletedAt: new Date('2024-06-01') }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(reject()({ data: { postId: 'p1' } })).rejects.toBeInstanceOf(ConflictError)
    expect(dbState.posts[0].deletedAt).toBeNull()
  })

  it('approveCommentFn refuses to publish when the parent post is soft-deleted', async () => {
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [
      {
        ...POST_DEFAULTS,
        id: 'p1',
        moderationState: 'published',
        deletedAt: new Date('2024-06-01'),
      },
    ]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approveComment()({ data: { commentId: 'c1' } })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(dbState.comments[0].moderationState).toBe('pending')
  })

  it('approveCommentFn refuses to publish when the grandparent board is soft-deleted', async () => {
    dbState.boards = [{ id: 'b1', name: 'Archived', deletedAt: new Date('2024-06-01') }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approveComment()({ data: { commentId: 'c1' } })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(dbState.comments[0].moderationState).toBe('pending')
  })

  it('rejectCommentFn refuses to soft-delete when the parent post is soft-deleted', async () => {
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [
      {
        ...POST_DEFAULTS,
        id: 'p1',
        moderationState: 'published',
        deletedAt: new Date('2024-06-01'),
      },
    ]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(rejectComment()({ data: { commentId: 'c1' } })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(dbState.comments[0].deletedAt).toBeNull()
  })

  it('approveCommentFn succeeds when parent post and board are both live', async () => {
    // Sanity: with valid parents the guarded UPDATE matches and the
    // comment flips to published.
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await approveComment()({ data: { commentId: 'c1' } })
    expect(dbState.comments[0].moderationState).toBe('published')
  })

  it('approveCommentFn calls announcePublishedComment with the commentId on success', async () => {
    // The deferred dispatch (webhooks) must fire after approve, mirroring
    // approvePostFn — held comments skip dispatch at create time, so the
    // approval is the only chance to emit comment.created.
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await approveComment()({ data: { commentId: 'c1' } })
    expect(mockAnnouncePublishedComment).toHaveBeenCalledOnce()
    expect(mockAnnouncePublishedComment).toHaveBeenCalledWith('c1')
  })

  it('approveCommentFn does NOT call announcePublishedComment when approve fails', async () => {
    // Already-published comments fail the guarded UPDATE and must not
    // emit a duplicate comment.created event.
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'published', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    await expect(approveComment()({ data: { commentId: 'c1' } })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(mockAnnouncePublishedComment).not.toHaveBeenCalled()
  })

  it('approveCommentFn increments commentCount on approval', async () => {
    // The insert path skipped the commentCount bump for pending comments
    // (see comment.service.ts); approveCommentFn is what reconciles the
    // public count when the comment becomes visible. Assert that the
    // follow-up `db.update(posts).set({ commentCount: ... })` fires after
    // the guarded comment UPDATE succeeds.
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    dbState.comments = [
      { ...COMMENT_DEFAULTS, id: 'c1', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)

    // Capture every set(...) payload that hits db.update(...) so we can
    // distinguish the (comments) moderationState flip from the (posts)
    // commentCount bump.
    const setPayloads: Array<Record<string, unknown>> = []
    const realUpdate = vi.mocked(db.update).getMockImplementation()!
    vi.mocked(db.update).mockImplementation((table: unknown) => {
      const inner = realUpdate(table as never) as unknown as {
        set: (patch: Record<string, unknown>) => unknown
      }
      return {
        set: (patch: Record<string, unknown>) => {
          setPayloads.push({ __table: tableNameOf(table), ...patch })
          return inner.set(patch)
        },
      } as never
    })

    try {
      await approveComment()({ data: { commentId: 'c1' } })
    } finally {
      vi.mocked(db.update).mockImplementation(realUpdate)
    }

    // Two writes total: comments flip → posts.commentCount bump.
    const postsBump = setPayloads.find((p) => p.__table === 'posts' && 'commentCount' in p)
    expect(postsBump).toBeDefined()
  })

  it('approveCommentFn does NOT touch commentCount for a private pending comment', async () => {
    // Private comments never incremented the public count at insert time —
    // approving them must not bump it either. (Private comments can't reach
    // pending state today since `isPrivate` is team-only, but defend the
    // invariant in case a future code path produces one.)
    dbState.boards = [{ id: 'b1', name: 'Active', deletedAt: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'published', deletedAt: null }]
    // Comment type used by this test file doesn't declare `isPrivate`;
    // the production code reads `before.isPrivate` directly, so attach
    // the flag with a localized cast.
    dbState.comments = [
      {
        ...COMMENT_DEFAULTS,
        id: 'c1',
        moderationState: 'pending',
        deletedAt: null,
      } as Comment,
    ]
    ;(dbState.comments[0] as Comment & { isPrivate?: boolean }).isPrivate = true
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)

    const setPayloads: Array<Record<string, unknown>> = []
    const realUpdate = vi.mocked(db.update).getMockImplementation()!
    vi.mocked(db.update).mockImplementation((table: unknown) => {
      const inner = realUpdate(table as never) as unknown as {
        set: (patch: Record<string, unknown>) => unknown
      }
      return {
        set: (patch: Record<string, unknown>) => {
          setPayloads.push({ __table: tableNameOf(table), ...patch })
          return inner.set(patch)
        },
      } as never
    })
    try {
      await approveComment()({ data: { commentId: 'c1' } })
    } finally {
      vi.mocked(db.update).mockImplementation(realUpdate)
    }

    const postsBump = setPayloads.find((p) => p.__table === 'posts' && 'commentCount' in p)
    expect(postsBump).toBeUndefined()
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
    const result = (await listPendingPosts()({ data: {} })) as {
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
    const result = (await listPendingPosts()({ data: {} })) as {
      posts: Array<{ id: string; boardName: string; authorName: string | null }>
    }
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0].boardName).toBe('Feature Requests')
    expect(result.posts[0].authorName).toBe('Bob')
  })

  it('excludes posts on a soft-deleted board', async () => {
    // A board that has been archived/soft-deleted must not surface its
    // pending posts into the moderation queue — otherwise moderators can
    // approve items into an inaccessible space.
    dbState.boards = [
      { id: 'b1', name: 'Active', deletedAt: null },
      { id: 'b2', name: 'Archived', deletedAt: new Date('2024-06-01') },
    ]
    dbState.principals = [{ id: 'pr1', displayName: 'Alice' }]
    dbState.posts = [
      { ...POST_DEFAULTS, id: 'p1', boardId: 'b1', moderationState: 'pending', deletedAt: null },
      { ...POST_DEFAULTS, id: 'p2', boardId: 'b2', moderationState: 'pending', deletedAt: null },
    ]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPendingPosts()({ data: {} })) as {
      posts: Array<{ id: string }>
    }
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0].id).toBe('p1')
  })

  it('authorName is null when principal has no displayName', async () => {
    dbState.boards = [{ id: 'b1', name: 'Ideas' }]
    dbState.principals = [{ id: 'pr1', displayName: null }]
    dbState.posts = [{ ...POST_DEFAULTS, id: 'p1', moderationState: 'pending', deletedAt: null }]
    mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
    const result = (await listPendingPosts()({ data: {} })) as {
      posts: Array<{ id: string; authorName: string | null }>
    }
    expect(result.posts[0].authorName).toBeNull()
  })
})

// ----------------------------------------------------------------------
// getModerationStatus
// ----------------------------------------------------------------------

// Helper: build a db.select mock that returns the pending counts.
// getModerationStatus issues THREE count queries (pending posts, pending
// comments, per-board approval flags), so stub all three. Pass a single
// number to treat it as the posts count and default comments/approval to 0
// (preserves the original single-table semantics for existing tests).
import { db } from '@/lib/server/db'

function stubSelectCalls(postsCount: number, commentsCount = 0, approvalCount = 0) {
  // The count queries join through parent tables (posts→boards, comments→
  // posts→boards) so the fluent chain may include one or more innerJoin
  // calls before the terminal where() resolves the promise. Make the chain
  // self-returning so any number of joins is supported.
  const makeCountChain = (n: number) => {
    const chain: Record<string, unknown> = {}
    chain.innerJoin = vi.fn(() => chain)
    chain.where = vi.fn(() => Promise.resolve([{ count: n }]))
    return {
      from: vi.fn(() => chain),
    }
  }
  vi.mocked(db.select)
    .mockImplementationOnce(() => makeCountChain(postsCount) as never)
    .mockImplementationOnce(() => makeCountChain(commentsCount) as never)
    .mockImplementationOnce(() => makeCountChain(approvalCount) as never)
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
    mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(getModerationStatusHandler()({ data: {} })).rejects.toThrow('Access denied')
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

  it('enabled=false when the workspace moderation policy is none AND no backlog', async () => {
    stubSelectCalls(0)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'none' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.enabled).toBe(false)
  })

  it('enabled=true when policy is none but a per-board backlog exists', async () => {
    // Per-board approval can route items to pending while the workspace
    // default is 'none'. The sidebar status must surface that backlog so
    // moderators can still find the queue — otherwise the badge silently
    // hides work.
    stubSelectCalls(2)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'none' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.enabled).toBe(true)
    expect(result.pendingCount).toBe(2)
  })

  it('enabled=true when a per-board approval flag is set, even with no policy and no backlog', async () => {
    // Per-board moderation override (e.g. one board has access.moderation.
    // anonPosts='on') means future submissions WILL be held — the sidebar
    // moderation badge must surface so admins can find the queue *before*
    // the first submission lands. Without this, the moderation surface is
    // discoverable only by chance when a backlog accumulates.
    stubSelectCalls(0, 0, 1)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'none' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.enabled).toBe(true)
    expect(result.pendingCount).toBe(0)
  })

  it('enabled=false when policy=none, no backlog, and no per-board approval flags', async () => {
    // Sanity counterpoint to the per-board test above: the badge must stay
    // hidden when nothing is configured AND nothing is pending.
    stubSelectCalls(0, 0, 0)
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

  it('survives a failure on one count query (allSettled) and contributes 0 for the failed branch', async () => {
    // Use a chain that rejects on .where() for the second query (comments).
    // The handler must still return a usable status response (posts count
    // intact) instead of bubbling the rejection up to the caller.
    const makeOk = (n: number) => {
      const chain: Record<string, unknown> = {}
      chain.innerJoin = vi.fn(() => chain)
      chain.where = vi.fn(() => Promise.resolve([{ count: n }]))
      return { from: vi.fn(() => chain) }
    }
    const makeFail = () => {
      const chain: Record<string, unknown> = {}
      chain.innerJoin = vi.fn(() => chain)
      chain.where = vi.fn(() => Promise.reject(new Error('db down')))
      return { from: vi.fn(() => chain) }
    }
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeOk(4) as never)
      .mockImplementationOnce(() => makeFail() as never)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'all' } })
    hoisted.logSpies.error.mockClear()
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.pendingCount).toBe(4)
    // The rejected count branch logs the failure via the structured logger.
    expect(hoisted.logSpies.error).toHaveBeenCalled()
  })

  it('pendingCount sums pending posts AND pending comments', async () => {
    // The moderation status badge in the admin sidebar must reflect total
    // moderator workload — both pending posts and pending comments. Without
    // this sum, a workspace with comment-only approval would show zero
    // pending even when the comments queue is non-empty.
    stubSelectCalls(3, 2)
    mockGetPortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'all' } })
    const result = (await getModerationStatusHandler()({ data: {} })) as {
      enabled: boolean
      pendingCount: number
    }
    expect(result.pendingCount).toBe(5)
  })
})
