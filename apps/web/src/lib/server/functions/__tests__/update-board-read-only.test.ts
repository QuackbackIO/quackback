/**
 * Setting a board read-only is a board setting: it takes board.manage, and
 * the flag reaches the service untouched. Nobody else can change it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({ handlers: [] as Handler[] }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator(schema: { parse: (data: unknown) => unknown }) {
        const inner = {
          handler(fn: Handler) {
            hoisted.handlers.push(async ({ data }) =>
              fn({ data: schema.parse(data) as Record<string, unknown> })
            )
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
vi.mock('./auth-helpers', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}))
vi.mock('./workspace', () => ({ getSettings: vi.fn() }))
const mockUpdateBoard = vi.fn()
vi.mock('@/lib/server/domains/boards/board.service', () => ({
  listBoards: vi.fn(),
  getBoardById: vi.fn(),
  createBoard: vi.fn(),
  updateBoard: (...a: unknown[]) => mockUpdateBoard(...a),
  deleteBoard: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: vi.fn(),
}))
vi.mock('@/lib/server/db', () => ({ db: {}, boards: {}, settings: {}, eq: vi.fn() }))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: vi.fn(), actorFromAuth: vi.fn() }))

import * as boardsModule from '../boards'

const BOARD_ID = 'board_01h455vb4pex5vsknk084sn02q'
// Handlers register in declaration order; updateBoardFn is the fifth.
const updateBoard = () => hoisted.handlers[4]

beforeEach(() => {
  mockRequireAuth.mockReset()
  mockUpdateBoard.mockReset()
})

describe('updateBoardFn read-only', () => {
  it('is the update handler', () => {
    expect(boardsModule.updateBoardFn).toBeDefined()
    expect(hoisted.handlers.length).toBeGreaterThanOrEqual(5)
  })

  it('asks for board.manage and passes the flag to the service', async () => {
    mockRequireAuth.mockResolvedValue({})
    mockUpdateBoard.mockResolvedValue({
      id: BOARD_ID,
      readOnly: true,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await updateBoard()({ data: { id: BOARD_ID, readOnly: true } })
    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.BOARD_MANAGE })
    expect(mockUpdateBoard).toHaveBeenCalledWith(
      BOARD_ID,
      expect.objectContaining({ readOnly: true })
    )
  })

  it('stops a teammate without board.manage before anything is written', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(updateBoard()({ data: { id: BOARD_ID, readOnly: true } })).rejects.toThrow(
      'Access denied'
    )
    expect(mockUpdateBoard).not.toHaveBeenCalled()
  })

  it('rejects a flag that is not a boolean', async () => {
    mockRequireAuth.mockResolvedValue({})
    await expect(updateBoard()({ data: { id: BOARD_ID, readOnly: 'yes' } })).rejects.toThrow()
    expect(mockUpdateBoard).not.toHaveBeenCalled()
  })
})
