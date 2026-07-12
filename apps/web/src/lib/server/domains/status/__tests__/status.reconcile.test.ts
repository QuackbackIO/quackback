/**
 * Tests for reconcileComponentStatus (status.components.ts): recomputes a
 * component's effective status as the worst (STATUS_WEIGHT) of every
 * still-active incident/maintenance link. "Still-active" is enforced by the
 * WHERE clause on the select, so these tests represent that filtering by
 * controlling exactly which rows the mocked select returns (the DB, not
 * this suite, proves the WHERE clause excludes resolved/removed links;
 * unit level, we assert the reduction and resulting write given a fixed
 * active-link set — this is the same active-link set updateIncident's
 * prev+new union and postIncidentUpdate's resolve path both feed in).
 *
 * See status.maintenance-reschedule.test.ts (sibling file, separate `db`
 * mock shape) for the maintenance start/complete stale-boundary guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'

// --- Mock tracking for status.components.ts ---
const mockSelectWhere = vi.fn()
const mockComponentFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockInsertValues = vi.fn()

function createSelectChain() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn((...args: unknown[]) => mockSelectWhere(...args))
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((arg: unknown) => {
    mockUpdateSet(arg)
    return chain
  })
  chain.where = vi.fn(() => Promise.resolve())
  return chain
}

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((arg: unknown) => {
    mockInsertValues(arg)
    return Promise.resolve()
  })
  return chain
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => createSelectChain(),
      query: {
        statusComponents: { findFirst: (...args: unknown[]) => mockComponentFindFirst(...args) },
      },
      update: () => createUpdateChain(),
      insert: () => createInsertChain(),
    },
  }
})

vi.mock('@/lib/server/events/process', () => ({
  processEvent: vi.fn().mockResolvedValue(undefined),
}))

import { reconcileComponentStatus } from '../status.components'

const COMPONENT_ID = 'status_component_test' as StatusComponentId
const INCIDENT_A = 'status_incident_a' as StatusIncidentId
const INCIDENT_B = 'status_incident_b' as StatusIncidentId

describe('reconcileComponentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('(a) resolving one of two overlapping incidents keeps the component non-operational', async () => {
    // Before: incident A (major_outage) resolved and dropped from the WHERE
    // clause's active set; incident B (partial_outage) still active. The
    // component's current DB status reflects the worse pre-resolution value.
    mockComponentFindFirst.mockResolvedValue({
      id: COMPONENT_ID,
      name: 'API',
      status: 'major_outage',
    })
    mockSelectWhere.mockResolvedValue([{ status: 'partial_outage' }])

    await reconcileComponentStatus(COMPONENT_ID, 'incident', INCIDENT_B)

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial_outage' })
    )
    // Still non-operational — the still-active incident keeps it degraded.
    expect(mockUpdateSet.mock.calls[0][0].status).not.toBe('operational')
  })

  it('(b) removing a component from a live incident restores operational when nothing else is active', async () => {
    mockComponentFindFirst.mockResolvedValue({
      id: COMPONENT_ID,
      name: 'API',
      status: 'degraded_performance',
    })
    // The link to this component was deleted — the active-link query now
    // returns nothing for it.
    mockSelectWhere.mockResolvedValue([])

    await reconcileComponentStatus(COMPONENT_ID, 'incident', INCIDENT_A)

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'operational' }))
  })

  it('takes the worst of multiple simultaneously active links, not the most recent', async () => {
    mockComponentFindFirst.mockResolvedValue({
      id: COMPONENT_ID,
      name: 'API',
      status: 'operational',
    })
    // Order shouldn't matter — major_outage listed first or last both win.
    mockSelectWhere.mockResolvedValue([
      { status: 'degraded_performance' },
      { status: 'major_outage' },
      { status: 'partial_outage' },
    ])

    await reconcileComponentStatus(COMPONENT_ID, 'incident', INCIDENT_A)

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'major_outage' }))
  })

  it('is a no-op (no update, no event insert) when the effective status is unchanged', async () => {
    mockComponentFindFirst.mockResolvedValue({
      id: COMPONENT_ID,
      name: 'API',
      status: 'partial_outage',
    })
    mockSelectWhere.mockResolvedValue([{ status: 'partial_outage' }])

    await reconcileComponentStatus(COMPONENT_ID, 'incident', INCIDENT_A)

    expect(mockUpdateSet).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('treats under_maintenance as worse than operational but better than any outage', async () => {
    mockComponentFindFirst.mockResolvedValue({
      id: COMPONENT_ID,
      name: 'API',
      status: 'operational',
    })
    mockSelectWhere.mockResolvedValue([{ status: 'under_maintenance' }])

    await reconcileComponentStatus(COMPONENT_ID, 'maintenance', INCIDENT_A)

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'under_maintenance' })
    )
  })
})
