/**
 * Differential-coverage tests for deleteBoard — the soft-delete + not-found
 * guard, the snapshot-present dispatch branch, and the fire-and-forget webhook
 * board_ids cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateResult: [] as unknown[],
  dispatchBoardDeleted: vi.fn(() => Promise.resolve()),
  execute: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  const chain: Record<string, unknown> = {}
  chain.set = () => chain
  chain.where = () => chain
  chain.returning = () => Promise.resolve(h.updateResult)
  chain.execute = () => h.execute()
  return {
    db: {
      query: { boards: { findFirst: h.findFirst } },
      update: () => chain,
    },
    boards: { id: 'b', deletedAt: 'd', boardIds: 'bi' },
    webhooks: { id: 'w', boardIds: 'wbi' },
    eq: drizzle.eq,
    and: drizzle.and,
    isNull: drizzle.isNull,
    sql: drizzle.sql,
  }
})
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchBoardCreated: vi.fn(),
  dispatchBoardUpdated: vi.fn(),
  dispatchBoardDeleted: h.dispatchBoardDeleted,
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({ getTierLimits: vi.fn() }))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({ enforceCountLimit: vi.fn() }))

import { deleteBoard } from '../board.service'
import type { BoardId } from '@quackback/ids'

beforeEach(() => {
  vi.clearAllMocks()
  h.updateResult = [{ id: 'board_1' }]
  h.findFirst.mockResolvedValue({ id: 'board_1', slug: 'bugs', name: 'Bugs' })
})

describe('deleteBoard', () => {
  it('soft-deletes, dispatches the deleted event, and cleans up webhook filters', async () => {
    await deleteBoard('board_1' as BoardId)
    expect(h.dispatchBoardDeleted).toHaveBeenCalledTimes(1)
    expect(h.execute).toHaveBeenCalledTimes(1)
  })

  it('skips the dispatch when there was no snapshot row', async () => {
    h.findFirst.mockResolvedValueOnce(undefined)
    await deleteBoard('board_1' as BoardId)
    expect(h.dispatchBoardDeleted).not.toHaveBeenCalled()
    expect(h.execute).toHaveBeenCalledTimes(1)
  })

  it('throws NotFoundError when the board does not exist (no rows updated)', async () => {
    h.updateResult = []
    await expect(deleteBoard('missing' as BoardId)).rejects.toThrow(/not found/i)
  })
})
