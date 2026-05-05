import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockedSelect: vi.fn(),
  mockedFindFirstBoards: vi.fn(),
  mockedInsert: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    db: {
      query: {
        boards: { findFirst: (...a: unknown[]) => hoisted.mockedFindFirstBoards(...a) },
      },
      select: hoisted.mockedSelect,
      insert: hoisted.mockedInsert,
    },
    boards: { id: 'b', slug: 's', deletedAt: 'd' },
    posts: { id: 'p' },
    webhooks: { id: 'w' },
    eq: drizzle.eq,
    and: drizzle.and,
    isNull: drizzle.isNull,
    inArray: drizzle.inArray,
    asc: drizzle.asc,
    sql: drizzle.sql,
  }
})

import { createBoard } from '../board.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('createBoard — maxBoards enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when at maxBoards cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      maxBoards: 3,
    })
    hoisted.mockedSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ count: 3 }]) }),
    })

    await expect(createBoard({ name: 'should-be-blocked' })).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not enforce when maxBoards is null (OSS default)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // Past the gate, downstream lookups happen — make slug-collision happy
    hoisted.mockedFindFirstBoards.mockResolvedValue(null)
    hoisted.mockedInsert.mockReturnValue({
      values: () => ({ returning: () => Promise.resolve([{ id: 'b1', name: 'x' }]) }),
    })

    await expect(createBoard({ name: 'allowed' })).resolves.toBeDefined()
  })
})
