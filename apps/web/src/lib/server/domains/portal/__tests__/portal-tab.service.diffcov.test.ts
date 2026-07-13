/**
 * Differential coverage tests for portal-tab.service.
 *
 * Drives the org-level cache, org config read/write, segment overrides
 * read/write/delete, and effective-config user resolution — covering both
 * success and error paths plus both sides of the listed conditionals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserId, SegmentId } from '@quackback/ids'
import type { PortalTabConfig } from '../types'

const mockLoggerError = vi.fn()

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbSelectDistinct: vi.fn(),
  dbUpdate: vi.fn(),
  dbInsert: vi.fn(),
  dbDelete: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLoggerError(...args),
    }),
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...a: unknown[]) => mocks.dbSelect(...a),
    selectDistinct: (...a: unknown[]) => mocks.dbSelectDistinct(...a),
    update: (...a: unknown[]) => mocks.dbUpdate(...a),
    insert: (...a: unknown[]) => mocks.dbInsert(...a),
    delete: (...a: unknown[]) => mocks.dbDelete(...a),
    query: {
      portalTabSegmentOverrides: {
        findFirst: (...a: unknown[]) => mocks.findFirst(...a),
        findMany: (...a: unknown[]) => mocks.findMany(...a),
      },
    },
  },
  eq: (...a: unknown[]) => mocks.eq(...a),
  settings: { portalTabConfig: 'settings.portalTabConfig' },
  userSegments: { segmentId: 'userSegments.segmentId', principalId: 'userSegments.principalId' },
  segments: { id: 'segments.id', name: 'segments.name' },
  portalTabSegmentOverrides: {
    id: 'portalTabSegmentOverrides.id',
    segmentId: 'portalTabSegmentOverrides.segmentId',
    overrides: 'portalTabSegmentOverrides.overrides',
  },
}))

const service = await import('../portal-tab.service')
const {
  invalidatePortalTabConfigCache,
  getOrgPortalTabConfig,
  setOrgPortalTabConfig,
  getSegmentTabOverrides,
  setSegmentTabOverrides,
  deleteSegmentTabOverrides,
  getEffectiveTabConfigForUser,
  getAllSegmentTabOverrides,
} = service

const SEGMENT_ID = 'segment_abc' as SegmentId
const USER_ID = 'user_xyz' as UserId

const DEFAULT_CONFIG: PortalTabConfig = {
  feedback: true,
  roadmap: true,
  changelog: true,
  myTickets: true,
  helpCenter: true,
  support: true,
}

// Helper builders for the various drizzle chain shapes.
function selectFromLimit(result: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(result),
    }),
  }
}

function selectFromJoinExecute(result: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

function selectDistinctChain(result: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Ensure the module-level cache is cleared between tests so cache hits/misses
  // are deterministic.
  invalidatePortalTabConfigCache()
})

describe('getOrgPortalTabConfig', () => {
  it('parses stored config from settings (cache miss) and caches it', async () => {
    const stored = JSON.stringify({ feedback: false, roadmap: true })
    mocks.dbSelect.mockReturnValueOnce(selectFromLimit([{ portalTabConfig: stored }]))

    const result = await getOrgPortalTabConfig()
    expect(result).toEqual({ feedback: false, roadmap: true })
    expect(mocks.dbSelect).toHaveBeenCalledTimes(1)

    // Second call hits the cache — db is not queried again (covers line 53-54).
    const cached = await getOrgPortalTabConfig()
    expect(cached).toEqual({ feedback: false, roadmap: true })
    expect(mocks.dbSelect).toHaveBeenCalledTimes(1)
  })

  it('returns defaults when no settings row / no stored config (raw falsy branch)', async () => {
    mocks.dbSelect.mockReturnValueOnce(selectFromLimit([{ portalTabConfig: null }]))

    const result = await getOrgPortalTabConfig()
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('returns defaults when settings table is empty (no rows)', async () => {
    mocks.dbSelect.mockReturnValueOnce(selectFromLimit([]))

    const result = await getOrgPortalTabConfig()
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it('returns defaults and logs on db error', async () => {
    mocks.dbSelect.mockImplementationOnce(() => {
      throw new Error('db down')
    })

    const result = await getOrgPortalTabConfig()
    expect(result).toEqual(DEFAULT_CONFIG)
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe('setOrgPortalTabConfig', () => {
  it('serializes, writes, and invalidates cache on success', async () => {
    // Seed the cache first.
    mocks.dbSelect.mockReturnValueOnce(selectFromLimit([{ portalTabConfig: '{"feedback":true}' }]))
    await getOrgPortalTabConfig()
    expect(mocks.dbSelect).toHaveBeenCalledTimes(1)

    const setMock = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) })
    mocks.dbUpdate.mockReturnValueOnce({ set: setMock })

    await setOrgPortalTabConfig({ feedback: false })
    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith({ portalTabConfig: JSON.stringify({ feedback: false }) })

    // Cache was invalidated → next read re-queries the db.
    mocks.dbSelect.mockReturnValueOnce(selectFromLimit([{ portalTabConfig: '{"feedback":false}' }]))
    await getOrgPortalTabConfig()
    expect(mocks.dbSelect).toHaveBeenCalledTimes(2)
  })

  it('throws on db error', async () => {
    mocks.dbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('write failed')),
      }),
    })

    await expect(setOrgPortalTabConfig({ feedback: true })).rejects.toThrow(
      'Failed to update portal tab configuration'
    )
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe('getSegmentTabOverrides', () => {
  it('returns parsed overrides when a row exists', async () => {
    mocks.findFirst.mockResolvedValueOnce({ overrides: { feedback: false, support: true } })

    const result = await getSegmentTabOverrides(SEGMENT_ID)
    expect(result).toEqual({ feedback: false, support: true })
  })

  it('returns null when no row exists', async () => {
    mocks.findFirst.mockResolvedValueOnce(undefined)

    const result = await getSegmentTabOverrides(SEGMENT_ID)
    expect(result).toBeNull()
  })

  it('returns null and logs on db error', async () => {
    mocks.findFirst.mockRejectedValueOnce(new Error('boom'))

    const result = await getSegmentTabOverrides(SEGMENT_ID)
    expect(result).toBeNull()
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe('setSegmentTabOverrides', () => {
  it('updates the existing record when one is present', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'override_1' })
    const whereMock = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) })
    const setMock = vi.fn().mockReturnValue({ where: whereMock })
    mocks.dbUpdate.mockReturnValueOnce({ set: setMock })

    await setSegmentTabOverrides(SEGMENT_ID, { feedback: false })
    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.dbInsert).not.toHaveBeenCalled()
    expect(setMock).toHaveBeenCalledWith({ overrides: { feedback: false } })
  })

  it('inserts a new record when none exists', async () => {
    mocks.findFirst.mockResolvedValueOnce(undefined)
    const valuesMock = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) })
    mocks.dbInsert.mockReturnValueOnce({ values: valuesMock })

    await setSegmentTabOverrides(SEGMENT_ID, { roadmap: true })
    expect(mocks.dbInsert).toHaveBeenCalledTimes(1)
    expect(mocks.dbUpdate).not.toHaveBeenCalled()
    expect(valuesMock).toHaveBeenCalledWith({ segmentId: SEGMENT_ID, overrides: { roadmap: true } })
  })

  it('throws and logs on db error', async () => {
    mocks.findFirst.mockRejectedValueOnce(new Error('lookup failed'))

    await expect(setSegmentTabOverrides(SEGMENT_ID, {})).rejects.toThrow(
      'Failed to update segment portal tab configuration'
    )
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe('deleteSegmentTabOverrides', () => {
  it('deletes the override record', async () => {
    const whereMock = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) })
    mocks.dbDelete.mockReturnValueOnce({ where: whereMock })

    await deleteSegmentTabOverrides(SEGMENT_ID)
    expect(mocks.dbDelete).toHaveBeenCalledTimes(1)
    expect(whereMock).toHaveBeenCalled()
  })

  it('throws and logs on db error', async () => {
    mocks.dbDelete.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('delete failed')),
      }),
    })

    await expect(deleteSegmentTabOverrides(SEGMENT_ID)).rejects.toThrow(
      'Failed to delete segment portal tab configuration'
    )
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe('getEffectiveTabConfigForUser', () => {
  function seedOrgConfig(stored: string | null) {
    mocks.dbSelect.mockReturnValueOnce(selectFromLimit([{ portalTabConfig: stored }]))
  }

  it('returns org defaults when user belongs to no segments', async () => {
    seedOrgConfig(null)
    mocks.dbSelectDistinct.mockReturnValueOnce(selectDistinctChain([]))

    const result = await getEffectiveTabConfigForUser(USER_ID)
    expect(result).toEqual(DEFAULT_CONFIG)
    // findMany should not be reached on the empty-segments branch.
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('returns org defaults when user has segments but no overrides', async () => {
    seedOrgConfig(null)
    mocks.dbSelectDistinct.mockReturnValueOnce(selectDistinctChain([{ segmentId: SEGMENT_ID }]))
    mocks.findMany.mockResolvedValueOnce([])

    const result = await getEffectiveTabConfigForUser(USER_ID)
    expect(result).toEqual(DEFAULT_CONFIG)
    expect(mocks.findMany).toHaveBeenCalledTimes(1)
  })

  it('merges org config with all segment overrides (union)', async () => {
    // Org config disables feedback; segment override re-enables it via union.
    seedOrgConfig(JSON.stringify({ feedback: false }))
    mocks.dbSelectDistinct.mockReturnValueOnce(
      selectDistinctChain([{ segmentId: SEGMENT_ID }, { segmentId: 'segment_def' as SegmentId }])
    )
    mocks.findMany.mockResolvedValueOnce([
      { overrides: { feedback: true } },
      { overrides: { roadmap: false } },
    ])

    const result = await getEffectiveTabConfigForUser(USER_ID)
    // Union logic: feedback enabled by a segment override; roadmap default-true.
    expect(result.feedback).toBe(true)
    expect(result.roadmap).toBe(true)
    expect(result.support).toBe(true)
  })

  it('verifies the inArray predicate builder passed to findMany', async () => {
    seedOrgConfig(null)
    mocks.dbSelectDistinct.mockReturnValueOnce(selectDistinctChain([{ segmentId: SEGMENT_ID }]))
    mocks.findMany.mockImplementationOnce((opts: { where: unknown }) => {
      // Exercise the closure passed as `where` to confirm it builds an inArray.
      const fn = (opts as { where: (t: unknown, h: { inArray: typeof builtInArray }) => unknown })
        .where
      const builtInArray = vi.fn().mockReturnValue('IN_ARRAY_EXPR')
      const built = fn({ segmentId: 'col' }, { inArray: builtInArray })
      expect(built).toBe('IN_ARRAY_EXPR')
      expect(builtInArray).toHaveBeenCalledWith('col', [SEGMENT_ID])
      return Promise.resolve([{ overrides: { feedback: true } }])
    })

    const result = await getEffectiveTabConfigForUser(USER_ID)
    expect(result.feedback).toBe(true)
  })

  it('returns defaults and logs on db error', async () => {
    // Org config read throws — the whole function falls into its catch.
    mocks.dbSelect.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    // getOrgPortalTabConfig swallows its own error and returns defaults, so the
    // outer flow continues; force selectDistinct to throw to hit the outer catch.
    mocks.dbSelectDistinct.mockImplementationOnce(() => {
      throw new Error('segments query failed')
    })

    const result = await getEffectiveTabConfigForUser(USER_ID)
    expect(result).toEqual(DEFAULT_CONFIG)
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe('getAllSegmentTabOverrides', () => {
  it('maps rows into typed overrides', async () => {
    mocks.dbSelect.mockReturnValueOnce(
      selectFromJoinExecute([
        {
          segmentId: SEGMENT_ID,
          segmentName: 'VIP',
          overrides: { feedback: false },
        },
      ])
    )

    const result = await getAllSegmentTabOverrides()
    expect(result).toEqual([
      { segmentId: SEGMENT_ID, segmentName: 'VIP', overrides: { feedback: false } },
    ])
  })

  it('returns empty array and logs on db error', async () => {
    mocks.dbSelect.mockImplementationOnce(() => {
      throw new Error('join failed')
    })

    const result = await getAllSegmentTabOverrides()
    expect(result).toEqual([])
    expect(mockLoggerError).toHaveBeenCalled()
  })
})
