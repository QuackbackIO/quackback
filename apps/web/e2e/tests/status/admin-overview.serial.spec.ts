/**
 * Status admin overview against the whole workspace's service state: runs in
 * the product-serial project, with no other test running.
 *
 * Journeys: STA-A-57.
 *
 * Every live service is set operational for the test (other specs leave theirs
 * in all sorts of states) and put back afterwards.
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { createSegment, createService, must, publicSnapshot } from '../../product/status'

test(
  'STA-A-57 the overview banner shows what visitors see, not gated services',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'getStatusOverviewAdminFn derives topLevelStatus from every service, segment-gated and plan-hidden ones included (functions/status.ts:624), so "Visitors currently see" can say a status no visitor sees; see QUARANTINE.md',
    },
  },
  async ({ playwright, marker }) => {
    const sql = supportDb()
    const saved = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM status_components WHERE deleted_at IS NULL`
    const admin = await personApi(playwright, 'admin')
    const anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    try {
      await sql`UPDATE status_components SET status = 'operational' WHERE deleted_at IS NULL`
      const segment = await createSegment(marker)
      const gated = await createService(admin, `${marker} Gated`, {
        segmentIds: [segment.id],
        status: 'major_outage',
      })
      expect(gated.status).toBe('major_outage')

      const visitors = await publicSnapshot(anon)
      expect((visitors as unknown as { topLevel: { status: string } }).topLevel.status).toBe(
        'operational'
      )
      const overview = await must<{ topLevelStatus: string }>(
        admin,
        'getStatusOverviewAdminFn',
        undefined,
        { method: 'GET' }
      )
      expect(overview.topLevelStatus).toBe('operational')
    } finally {
      for (const row of saved) {
        await sql`UPDATE status_components SET status = ${row.status} WHERE id = ${row.id}`
      }
      await sql`UPDATE status_components SET deleted_at = now()
        WHERE name = ${`${marker} Gated`}`
      await admin.dispose()
      await anon.dispose()
    }
  }
)
