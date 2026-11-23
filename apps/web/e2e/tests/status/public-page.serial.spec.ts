/**
 * The public page's headline status, which every service in the workspace
 * feeds: runs in the product-serial project, with no other test running.
 *
 * Journeys: STA-P-18.
 *
 * Every live service is set operational for the test and put back after.
 * The hero only renders with no active incident, which other specs' leftovers
 * can break, so this reads the status behind it (`topLevel.status`) as an
 * anonymous visitor gets it.
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import {
  createSegment,
  createService,
  publicSnapshot,
  setServiceStatus,
  type ServiceStatus,
} from '../../product/status'

test(
  'STA-P-18 the headline follows the worst visible status',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const sql = supportDb()
    const saved = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM status_components WHERE deleted_at IS NULL`
    const admin = await personApi(playwright, 'admin')
    const anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    try {
      await sql`UPDATE status_components SET status = 'operational' WHERE deleted_at IS NULL`
      const visible = await createService(admin, `${marker} Visible`)
      const segment = await createSegment(marker)
      const gated = await createService(admin, `${marker} Gated`, { segmentIds: [segment.id] })
      const headline = async () =>
        ((await publicSnapshot(anon)) as unknown as { topLevel: { status: string } }).topLevel
          .status
      expect(await headline()).toBe('operational')
      for (const status of [
        'degraded_performance',
        'partial_outage',
        'major_outage',
        'under_maintenance',
      ] as ServiceStatus[]) {
        await setServiceStatus(admin, visible.id, status)
        expect(await headline(), status).toBe(status)
      }
      await setServiceStatus(admin, visible.id, 'operational')
      // A service the visitor cannot see never moves it.
      await setServiceStatus(admin, gated.id, 'major_outage')
      expect(await headline()).toBe('operational')
    } finally {
      for (const row of saved) {
        await sql`UPDATE status_components SET status = ${row.status} WHERE id = ${row.id}`
      }
      await sql`UPDATE status_components SET deleted_at = now() WHERE name LIKE ${`${marker}%`}`
      await admin.dispose()
      await anon.dispose()
    }
  }
)
