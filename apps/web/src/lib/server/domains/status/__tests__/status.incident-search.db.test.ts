/**
 * Admin incident search against real Postgres. The list reads through the
 * relational query builder, which rewrites every column object in a raw `sql`
 * fragment onto the root table's alias, so an EXISTS over the updates table
 * must name its own columns raw. Only real SQL shows that.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { statusIncidentUpdates, statusIncidents } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listStatusIncidents } from '../status.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusIncidentUpdates.id }).from(statusIncidentUpdates).limit(0)
  },
})

describe.skipIf(!fixture.available)('listStatusIncidents search (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('matches an incident by its title or by any update body', async () => {
    const term = `zq${Date.now().toString(36)}`
    const [byTitle, byUpdate] = await testDb
      .insert(statusIncidents)
      .values([
        { kind: 'incident', title: `Outage ${term}`, status: 'investigating' },
        { kind: 'incident', title: 'Slow checkout', status: 'investigating' },
        { kind: 'incident', title: 'Unrelated', status: 'investigating' },
      ])
      .returning()
    await testDb
      .insert(statusIncidentUpdates)
      .values({ incidentId: byUpdate.id, status: 'investigating', body: `Error ${term} seen` })

    const result = await listStatusIncidents({ search: term })

    expect(result.items.map((i) => i.id).sort()).toEqual([byTitle.id, byUpdate.id].sort())
  })
})
