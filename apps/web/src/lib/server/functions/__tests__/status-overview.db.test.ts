/**
 * getStatusOverviewAdminFn against real Postgres: the overview lists a
 * running maintenance window however many windows are still ahead. Each
 * list is capped, so a running window must not compete for the same slots
 * as newer scheduled ones.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, sql, statusComponents, statusIncidents } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
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
vi.mock('../auth-helpers', async () => ({
  requireAuth: vi.fn().mockResolvedValue({ principal: { id: 'principal_1' } }),
  getOptionalAuth: vi.fn(),
  policyActorFromAuth: vi
    .fn()
    .mockResolvedValue((await import('@/lib/server/policy/types')).ANONYMOUS_ACTOR),
}))
vi.mock('../portal-access', () => ({ resolvePortalAccessForRequest: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: vi.fn().mockResolvedValue({ enabled: true }),
  updateStatusSettings: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceStatusComponentLimit: vi.fn(),
}))
vi.mock('@/lib/server/events/process', () => ({ processEvent: vi.fn() }))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))

import { createIncident, createStatusComponent } from '@/lib/server/domains/status'
import { getStatusOverviewAdminFn } from '../status'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ notify: statusIncidents.notifySubscribers }).from(statusIncidents).limit(0)
  },
})

const HOUR = 60 * 60 * 1000
let author: PrincipalId

const getOverview = getStatusOverviewAdminFn as unknown as () => Promise<{
  topLevelStatus: string
  liveMaintenance: { id: string }[]
  upcomingMaintenance: { id: string }[]
}>

describe('status overview (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    author = createId('principal')
    await testDb
      .insert(principal)
      .values({ id: author, role: 'admin', type: 'service', createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function maintenance(status: 'in_progress' | 'scheduled', startInHours: number) {
    const db = await createStatusComponent({ name: 'Database' })
    const start = new Date(Date.now() + startInHours * HOUR)
    return createIncident(
      {
        kind: 'maintenance',
        title: `${status} ${startInHours}`,
        status,
        body: 'Planned upgrade.',
        affectedComponents: [{ componentId: db.id, componentStatus: 'under_maintenance' }],
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + HOUR),
        notifySubscribers: false,
      },
      { principalId: author }
    )
  }

  /** Dates a row's creation a week back, before everything created after it. */
  async function createdLastWeek(id: string) {
    await testDb
      .update(statusIncidents)
      .set({ createdAt: new Date(Date.now() - 7 * 24 * HOUR) })
      .where(eq(statusIncidents.id, id as never))
  }

  it('lists a running window even behind more than a page of newer scheduled ones', async () => {
    const running = await maintenance('in_progress', -1)
    await createdLastWeek(running.id)
    for (let i = 1; i <= 21; i++) await maintenance('scheduled', i)

    const overview = await getOverview()
    expect(overview.liveMaintenance.map((w) => w.id)).toEqual([running.id])
    expect(overview.upcomingMaintenance).toHaveLength(20)
    expect(overview.upcomingMaintenance.map((w) => w.id)).not.toContain(running.id)
  })

  it('lists the soonest upcoming windows, however long ago they were scheduled', async () => {
    const soonest = await maintenance('scheduled', 1)
    await createdLastWeek(soonest.id)
    for (let i = 2; i <= 22; i++) await maintenance('scheduled', i)

    const overview = await getOverview()
    expect(overview.upcomingMaintenance).toHaveLength(20)
    expect(overview.upcomingMaintenance[0]?.id).toBe(soonest.id)
  })

  it('"Visitors currently see" leaves out a gated service, as the public page does', async () => {
    await testDb
      .update(statusComponents)
      .set({ status: 'operational' })
      .where(sql`true`)
    await createStatusComponent({
      name: 'Team only',
      status: 'major_outage',
      segmentIds: [createId('segment')],
    })
    expect((await getOverview()).topLevelStatus).toBe('operational')
  })
})
