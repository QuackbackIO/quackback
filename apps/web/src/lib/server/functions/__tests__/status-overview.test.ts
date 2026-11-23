/**
 * getStatusOverviewAdminFn: an open maintenance window is either running
 * now or still ahead. Running ones are live (listed like open incidents);
 * only the ones still ahead are "upcoming", soonest first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ principal: { id: 'principal_1' } }),
  getOptionalAuth: vi.fn(),
  policyActorFromAuth: vi.fn().mockResolvedValue({ principalType: 'team' }),
}))
vi.mock('../portal-access', () => ({ resolvePortalAccessForRequest: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: vi.fn().mockResolvedValue({ enabled: true }),
  updateStatusSettings: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceStatusComponentLimit: vi.fn(),
}))

const mockListStatusIncidents = vi.fn()
vi.mock('@/lib/server/domains/status', () => ({
  listStatusComponentGroupsWithComponents: vi.fn().mockResolvedValue([]),
  listUngroupedStatusComponents: vi.fn().mockResolvedValue([]),
  listStatusIncidents: (...args: unknown[]) => mockListStatusIncidents(...args),
  getStatusSubscriptionCounts: vi.fn().mockResolvedValue({ active: 0, total: 0 }),
  countStatusSubscriptionsSince: vi.fn().mockResolvedValue(0),
  countStatusIncidentsSince: vi.fn().mockResolvedValue(0),
  getVisitorTopLevelStatus: vi.fn().mockResolvedValue('operational'),
  getUptimeSeries: vi.fn().mockResolvedValue([]),
}))

import { getStatusOverviewAdminFn } from '../status'

const HOUR = 60 * 60 * 1000

function window(id: string, status: string, startInHours: number) {
  const start = new Date(Date.now() + startInHours * HOUR)
  return {
    id,
    kind: 'maintenance',
    title: id,
    status,
    impact: 'maintenance',
    impactOverride: false,
    scheduledStartAt: start,
    scheduledEndAt: new Date(start.getTime() + HOUR),
    autoStart: true,
    autoComplete: true,
    startedAt: start,
    resolvedAt: null,
    backfilled: false,
    notifiedAt: null,
    notifySubscribers: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    affectedComponents: [],
    updates: [],
  }
}

beforeEach(() => {
  const maintenance = [
    window('later', 'scheduled', 48),
    // Started early by hand: its plan is still a day ahead.
    window('running', 'in_progress', 24),
    window('verifying', 'verifying', -1),
    window('sooner', 'scheduled', 2),
  ]
  mockListStatusIncidents.mockImplementation(
    async ({ kind, statuses, order }: { kind: string; statuses?: string[]; order?: string }) => {
      const items =
        kind === 'maintenance'
          ? maintenance.filter((m) => !statuses || statuses.includes(m.status))
          : []
      if (order === 'soonest') {
        items.sort((a, b) => a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime())
      }
      return { items, nextCursor: null, hasMore: false }
    }
  )
})

describe('getStatusOverviewAdminFn maintenance', () => {
  it('lists running windows as live and only windows still ahead as upcoming', async () => {
    const overview = await (
      getStatusOverviewAdminFn as unknown as () => Promise<{
        liveMaintenance: { id: string }[]
        upcomingMaintenance: { id: string }[]
      }>
    )()

    expect(overview.liveMaintenance.map((w) => w.id)).toEqual(['running', 'verifying'])
    expect(overview.upcomingMaintenance.map((w) => w.id)).toEqual(['sooner', 'later'])
  })
})
