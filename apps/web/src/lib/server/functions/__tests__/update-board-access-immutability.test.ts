/**
 * updateBoardFn must NOT write board.access.
 *
 * Board visibility changes are admin-only policy operations gated behind
 * updateBoardAccessFn. updateBoardFn is team-reachable and must only mutate
 * name / description / settings — never access. This file guards that
 * contract and the simplification that follows from removing the access
 * write path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const hoisted = vi.hoisted(() => ({
  handlers: [] as AnyHandler[],
  mockRequireAuth: vi.fn(),
  mockUpdateBoard: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        hoisted.handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('./auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.mockRequireAuth(...args),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.mockRequireAuth(...args),
}))

vi.mock('./workspace', () => ({ getSettings: vi.fn() }))

// --- Board service mock ---
vi.mock('@/lib/server/domains/boards/board.service', () => ({
  listBoards: vi.fn(),
  getBoardById: vi.fn(),
  createBoard: vi.fn(),
  updateBoard: (...args: unknown[]) => hoisted.mockUpdateBoard(...args),
  deleteBoard: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: vi.fn(),
}))

// --- DB mock: db.update must NOT be called by updateBoardFn ---
vi.mock('@/lib/server/db', () => ({
  db: {
    update: (...args: unknown[]) => hoisted.mockDbUpdate(...args),
    query: {
      boards: { findFirst: vi.fn() },
    },
  },
  settings: {},
  boards: {
    id: { __col: 'id' },
    deletedAt: { __col: 'deletedAt' },
  },
  eq: vi.fn((col: { __col: string }, val: unknown) => ({ kind: 'eq', col: col.__col, val })),
  and: vi.fn((...conds: unknown[]) => ({ kind: 'and', conds })),
  isNull: vi.fn((col: { __col: string }) => ({ kind: 'isNull', col: col.__col })),
  // T15's boardAccessSchema in boards.ts reads these at module-eval time.
  ACCESS_TIERS: ['anonymous', 'authenticated', 'segments', 'team'] as const,
  ACCESS_TIER_RANK: { anonymous: 0, authenticated: 1, segments: 2, team: 3 } as const,
}))

vi.mock('@/lib/shared/roles', () => ({
  isAdmin: vi.fn((role: string) => role === 'admin'),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
  actorFromAuth: vi.fn(),
}))

// Import after mocks — updateBoardFn is handler #6 (0-indexed) in boards.ts
// (workspace.ts adds handlers 0-2 before boards.ts adds its own:
//  3=fetchBoardsFn, 4=fetchBoardFn, 5=createBoardFn, 6=updateBoardFn,
//  7=deleteBoardFn, 8=createBoardsBatchFn, 9=updateBoardAccessFn)
import * as boardsModule from '../boards'

function getUpdateBoardFn(): AnyHandler {
  expect(boardsModule).toHaveProperty('updateBoardFn')
  return hoisted.handlers[6]
}

const BOARD_ID = 'board_test_1'
const BASE_DATE = new Date('2025-01-01T00:00:00Z')

type BoardAccess = {
  view: 'anonymous' | 'authenticated' | 'segments' | 'team'
  comment: 'anonymous' | 'authenticated' | 'segments' | 'team'
  submit: 'anonymous' | 'authenticated' | 'segments' | 'team'
  segmentIds: string[]
  approval: { posts: boolean; comments: boolean }
}
type BoardRow = {
  id: string
  name: string
  slug: string
  description: string | null
  access: BoardAccess
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

const BOARD_ROW: BoardRow = {
  id: BOARD_ID,
  name: 'My Board',
  slug: 'my-board',
  description: null,
  access: {
    view: 'segments',
    comment: 'segments',
    submit: 'segments',
    segmentIds: ['seg_1'],
    approval: { posts: false, comments: false },
  },
  settings: {},
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  deletedAt: null,
}

const AUTH = {
  user: { id: 'u_1', email: 'user@x', name: 'User', image: null },
  principal: { id: 'p_1', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}

beforeEach(() => {
  hoisted.mockDbUpdate.mockReset()
  hoisted.mockRequireAuth.mockReset()
  hoisted.mockRequireAuth.mockResolvedValue(AUTH)
  hoisted.mockUpdateBoard.mockReset()
  hoisted.mockUpdateBoard.mockResolvedValue(BOARD_ROW)
})

describe('updateBoardFn — access immutability', () => {
  it('does not call db.update (no access write) when updating name', async () => {
    await getUpdateBoardFn()({ data: { id: BOARD_ID, name: 'Renamed' } })
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('returns the board from updateBoard service without touching access', async () => {
    const result = (await getUpdateBoardFn()({
      data: { id: BOARD_ID, name: 'Renamed' },
    })) as { access: BoardAccess }

    // The segments access must come back intact — no clobber
    expect(result.access.view).toBe('segments')
    expect(result.access.segmentIds).toEqual(['seg_1'])
  })

  it('passes name / description / settings to updateBoard service', async () => {
    await getUpdateBoardFn()({
      data: { id: BOARD_ID, name: 'New Name', description: 'New desc' },
    })

    expect(hoisted.mockUpdateBoard).toHaveBeenCalledWith(
      BOARD_ID,
      expect.objectContaining({ name: 'New Name', description: 'New desc' })
    )
  })

  it('does not call db.update even when called with no optional fields', async () => {
    await getUpdateBoardFn()({ data: { id: BOARD_ID } })
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })
})
