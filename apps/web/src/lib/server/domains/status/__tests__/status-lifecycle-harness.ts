/**
 * Shared setup for the status lifecycle suites against real Postgres
 * (status.lifecycle.db.test.ts and status.maintenance-timing.db.test.ts):
 * the always-rolled-back fixture, an admin author for each test, and
 * builders for services, incidents and maintenance windows. Each suite mocks
 * the global `db` onto the fixture's testDb itself.
 */
import { vi } from 'vitest'
import { createId, type PrincipalId, type StatusComponentId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, statusComponents, statusIncidents } from '@/lib/server/db'
import { createStatusComponent } from '../status.components'
import { createIncident } from '../status.service'

/** Every statement the fixture's connection sends, for suites that pin them. */
export const statements: { query: string; params: unknown[] }[] = []
export const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: statusIncidents.id, notify: statusIncidents.notifySubscribers })
      .from(statusIncidents)
      .limit(0)
  },
  logger: { logQuery: (query, params) => statements.push({ query, params }) },
})

export const HOUR = 60 * 60 * 1000
/** The admin that authors the current test's writes (see beginTest). */
export let author: PrincipalId

/** Opens the test's transaction and adds its author. Call from beforeEach. */
export async function beginTest(): Promise<void> {
  await fixture.begin()
  author = createId('principal')
  await testDb
    .insert(principal)
    .values({ id: author, role: 'admin', type: 'service', createdAt: new Date() })
}

export async function service(name: string): Promise<StatusComponentId> {
  return (await createStatusComponent({ name })).id
}

export async function openIncident(
  affected: {
    componentId: StatusComponentId
    componentStatus: 'major_outage' | 'degraded_performance'
  }[]
) {
  return createIncident(
    {
      kind: 'incident',
      title: 'Errors',
      status: 'investigating',
      body: 'Looking into it.',
      affectedComponents: affected,
      notifySubscribers: false,
    },
    { principalId: author }
  )
}

export async function scheduleWindow(start: Date, end: Date) {
  const db = await service('Database')
  return createIncident(
    {
      kind: 'maintenance',
      title: 'Upgrade',
      status: 'scheduled',
      body: 'Planned upgrade.',
      affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
      scheduledStartAt: start,
      scheduledEndAt: end,
      notifySubscribers: false,
    },
    { principalId: author }
  )
}

export function isRecent(date: Date) {
  return Math.abs(Date.now() - date.getTime()) < 60_000
}

export async function statusOf(id: StatusComponentId) {
  const row = await testDb.query.statusComponents.findFirst({
    where: eq(statusComponents.id, id),
  })
  return row?.status
}

/** Runs `handler` with its first read of an incident answered from before
 *  `other` ran: `handler` read the row, then `other` changed it, then
 *  `handler` writes. */
export async function raceOnStaleRead(handler: () => Promise<void>, other: () => Promise<void>) {
  const read = testDb.query.statusIncidents
  const realFindFirst = read.findFirst.bind(read)
  const spy = vi.spyOn(read, 'findFirst').mockImplementationOnce((async (
    config: Parameters<typeof realFindFirst>[0]
  ) => {
    const stale = await realFindFirst(config)
    await other()
    return stale
  }) as never)
  try {
    await handler()
  } finally {
    spy.mockRestore()
  }
}
