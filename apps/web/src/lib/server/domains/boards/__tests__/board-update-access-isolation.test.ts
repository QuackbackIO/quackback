/**
 * G2 regression: updateBoard (the generic service) must not touch access.
 * Access is a policy-level field, admin-only via updateBoardAccessFn.
 *
 * Structural guarantee: UpdateBoardInput (board.types.ts) omits the access
 * field entirely, so passing access to updateBoard is a TypeScript error.
 * This test verifies the runtime behavior matches that guarantee.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockedFindFirst: vi.fn(),
  mockedUpdate: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  const fakeUpdate = hoisted.mockedUpdate
  return {
    db: {
      query: {
        boards: { findFirst: (...a: unknown[]) => hoisted.mockedFindFirst(...a) },
      },
      update: (...a: unknown[]) => fakeUpdate(...a),
    },
    boards: { id: 'id', slug: 'slug', deletedAt: 'deletedAt' },
    posts: { boardId: 'boardId', deletedAt: 'deletedAt' },
    webhooks: { boardIds: 'boardIds' },
    eq: drizzle.eq,
    and: drizzle.and,
    isNull: drizzle.isNull,
    inArray: drizzle.inArray,
    asc: drizzle.asc,
    sql: drizzle.sql,
  }
})

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceCountLimit: vi.fn(),
}))

import { updateBoard } from '../board.service'
import type { BoardId } from '@quackback/ids'

const BOARD_ID = 'board_01' as unknown as BoardId

const EXISTING_BOARD = {
  id: BOARD_ID,
  name: 'Original',
  slug: 'original',
  description: null,
  access: {
    view: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segmentIds: [],
    approval: { posts: false, comments: false },
  },
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

/** Tracks the `set(...)` argument from the last db.update().set() call */
let capturedSet: Record<string, unknown> = {}

function setupUpdateMock(updatedBoard = EXISTING_BOARD) {
  hoisted.mockedUpdate.mockReturnValue({
    set: vi.fn((patch: Record<string, unknown>) => {
      capturedSet = patch
      return {
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([updatedBoard]),
        })),
      }
    }),
  })
}

beforeEach(() => {
  capturedSet = {}
  vi.clearAllMocks()
  hoisted.mockedFindFirst.mockResolvedValue(EXISTING_BOARD)
  setupUpdateMock()
})

describe('updateBoard — access isolation (G2)', () => {
  it('never writes access to the DB when a name update is requested', async () => {
    await updateBoard(BOARD_ID, { name: 'New Name' })
    expect(capturedSet).not.toHaveProperty('access')
  })

  it('never writes access when description changes', async () => {
    await updateBoard(BOARD_ID, { description: 'hello' })
    expect(capturedSet).not.toHaveProperty('access')
  })

  it('never writes access when settings change', async () => {
    await updateBoard(BOARD_ID, { settings: {} })
    expect(capturedSet).not.toHaveProperty('access')
  })

  it('does update name and description normally', async () => {
    await updateBoard(BOARD_ID, { name: 'Changed', description: 'desc' })
    expect(capturedSet).toHaveProperty('name', 'Changed')
    expect(capturedSet).toHaveProperty('description', 'desc')
  })
})
