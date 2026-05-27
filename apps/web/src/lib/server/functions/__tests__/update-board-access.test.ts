/**
 * Tests for updateBoardAccessFn.
 *
 * The handler accepts a `BoardAccess` matrix (view/comment/submit + segmentIds
 * + approval). boardAccessSchema's tier-rank invariants must be enforced by
 * input validation so callers can't slip an inconsistent matrix past the
 * server. Each successful call writes the matrix and records a
 * `board.access.changed` audit event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({ handlers: [] as Handler[] }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator(parse: (data: unknown) => unknown) {
        // Capture the validator so we can drive it at the handler call site —
        // a Zod schema gates inputs, and we need real validation errors to
        // bubble out (not silently bypass).
        const inner = {
          handler(fn: Handler) {
            const wrapped: Handler = async ({ data }) => {
              const validated = parse(data)
              return fn({ data: validated as Record<string, unknown> })
            }
            hoisted.handlers.push(wrapped)
            return inner
          },
        }
        return inner
      },
      handler(fn: Handler) {
        hoisted.handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const mockRequireAuth = vi.fn()
vi.mock('./auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

vi.mock('./workspace', () => ({ getSettings: vi.fn() }))

vi.mock('@/lib/server/domains/boards/board.service', () => ({
  listBoards: vi.fn(),
  getBoardById: vi.fn(),
  createBoard: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: vi.fn(),
}))

type BoardRow = {
  id: string
  access?: Record<string, unknown>
}
const state: {
  boards: BoardRow[]
  updates: Array<Partial<BoardRow>>
  auditEvents: Array<Record<string, unknown>>
} = {
  boards: [],
  updates: [],
  auditEvents: [],
}

interface BoardsColumn {
  __col: keyof BoardRow
}
type BoardCondition = { kind: 'eq'; col: keyof BoardRow; val: string }

function matchBoard(b: BoardRow, c: BoardCondition): boolean {
  return b[c.col] === c.val
}

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      boards: {
        findFirst: vi.fn(async (args: { where: BoardCondition }) =>
          state.boards.find((b) => matchBoard(b, args.where))
        ),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((patch: Partial<BoardRow>) => ({
        where: vi.fn(async (cond: BoardCondition) => {
          state.updates.push(patch)
          state.boards = state.boards.map((b) => (matchBoard(b, cond) ? { ...b, ...patch } : b))
        }),
      })),
    })),
    settings: {},
    eq: vi.fn(),
  },
  boards: {
    id: { __col: 'id' } satisfies BoardsColumn,
  },
  settings: {},
  eq: vi.fn(
    (col: BoardsColumn, val: string): BoardCondition => ({
      kind: 'eq',
      col: col.__col,
      val,
    })
  ),
  // Real constants from db re-export — keep in sync with the schema-level enum.
  ACCESS_TIERS: ['anonymous', 'authenticated', 'segments', 'team'] as const,
  ACCESS_TIER_RANK: { anonymous: 0, authenticated: 1, segments: 2, team: 3 } as const,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    state.auditEvents.push(e)
  }),
  actorFromAuth: vi.fn(
    (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
      userId: auth.user.id,
      email: auth.user.email,
      role: auth.principal.role,
    })
  ),
}))

// Import after mocks; the handler is captured by the createServerFn shim above.
import * as boardsModule from '../boards'

function getUpdateBoardAccessFn(): Handler {
  expect(boardsModule).toHaveProperty('updateBoardAccessFn')
  return hoisted.handlers[hoisted.handlers.length - 1]
}

const AUTH_ADMIN = {
  user: { id: 'u_admin', email: 'admin@x', name: 'Admin', image: null },
  principal: { id: 'p_admin', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}

const BOARD_DEFAULT: BoardRow = {
  id: 'board_1',
  access: {
    view: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segmentIds: [],
    approval: { posts: false, comments: false },
  },
}

beforeEach(() => {
  state.boards = [{ ...BOARD_DEFAULT }]
  state.updates = []
  state.auditEvents = []
  mockRequireAuth.mockReset()
  mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
})

describe('updateBoardAccessFn — accepts BoardAccess payload', () => {
  it('accepts an access object shaped like BoardAccess', async () => {
    await getUpdateBoardAccessFn()({
      data: {
        boardId: 'board_1',
        access: {
          view: 'anonymous',
          comment: 'anonymous',
          submit: 'anonymous',
          segmentIds: [],
          approval: { posts: false, comments: false },
        },
      },
    })
    expect(state.updates).toHaveLength(1)
  })

  it('rejects an access with comment tier below view tier', async () => {
    await expect(
      getUpdateBoardAccessFn()({
        data: {
          boardId: 'board_1',
          access: {
            view: 'authenticated',
            comment: 'anonymous',
            submit: 'authenticated',
            segmentIds: [],
            approval: { posts: false, comments: false },
          },
        },
      })
    ).rejects.toThrow()
  })

  it('rejects an access with segments tier and empty segmentIds', async () => {
    await expect(
      getUpdateBoardAccessFn()({
        data: {
          boardId: 'board_1',
          access: {
            view: 'segments',
            comment: 'segments',
            submit: 'segments',
            segmentIds: [],
            approval: { posts: false, comments: false },
          },
        },
      })
    ).rejects.toThrow()
  })
})

describe('updateBoardAccessFn — writes access and emits audit event', () => {
  it('writes access to the boards row', async () => {
    const access = {
      view: 'authenticated' as const,
      comment: 'team' as const,
      submit: 'team' as const,
      segmentIds: [],
      approval: { posts: true, comments: false },
    }
    await getUpdateBoardAccessFn()({ data: { boardId: 'board_1', access } })

    expect(state.updates).toHaveLength(1)
    const patch = state.updates[0] as { access?: unknown }
    expect(patch.access).toEqual(access)
  })

  it('fires board.access.changed audit with before/after access', async () => {
    const access = {
      view: 'authenticated' as const,
      comment: 'team' as const,
      submit: 'team' as const,
      segmentIds: [],
      approval: { posts: true, comments: false },
    }
    await getUpdateBoardAccessFn()({ data: { boardId: 'board_1', access } })

    expect(state.auditEvents).toHaveLength(1)
    expect(state.auditEvents[0].event).toBe('board.access.changed')
    const before = state.auditEvents[0].before as { access: unknown }
    const after = state.auditEvents[0].after as { access: unknown }
    expect(before.access).toEqual(BOARD_DEFAULT.access)
    expect(after.access).toEqual(access)
  })
})

describe('updateBoardAccessFn — auth + not-found', () => {
  it('propagates requireAuth rejection (no swallowing 401 into 500)', async () => {
    const authError = new Error('UNAUTHORIZED')
    mockRequireAuth.mockReset()
    mockRequireAuth.mockRejectedValue(authError)
    await expect(
      getUpdateBoardAccessFn()({
        data: {
          boardId: 'board_1',
          access: {
            view: 'anonymous',
            comment: 'anonymous',
            submit: 'anonymous',
            segmentIds: [],
            approval: { posts: false, comments: false },
          },
        },
      })
    ).rejects.toBe(authError)
    expect(state.updates).toEqual([])
    expect(state.auditEvents).toEqual([])
  })

  it('rejects non-admin (member) with ForbiddenError', async () => {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    mockRequireAuth.mockReset()
    mockRequireAuth.mockResolvedValue({
      ...AUTH_ADMIN,
      principal: { ...AUTH_ADMIN.principal, role: 'member' as const },
    })
    await expect(
      getUpdateBoardAccessFn()({
        data: {
          boardId: 'board_1',
          access: {
            view: 'anonymous',
            comment: 'anonymous',
            submit: 'anonymous',
            segmentIds: [],
            approval: { posts: false, comments: false },
          },
        },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns NotFoundError for missing boardId', async () => {
    const { NotFoundError } = await import('@/lib/shared/errors')
    await expect(
      getUpdateBoardAccessFn()({
        data: {
          boardId: 'missing',
          access: {
            view: 'anonymous',
            comment: 'anonymous',
            submit: 'anonymous',
            segmentIds: [],
            approval: { posts: false, comments: false },
          },
        },
      })
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
