/**
 * Status admin: the Overview.
 *
 * Journeys: STA-A-56.
 *
 * The banner and tiles are workspace-wide, so this asserts only that its own
 * incident and windows show in the right cards, and that the 30-day tile
 * counts its incident.
 */
import { test, expect } from '../../support/fixtures'
import type { APIRequestContext } from '@playwright/test'
import { callServerFn, personApi } from '../../support/server-fns'
import {
  createIncident,
  createService,
  must,
  openAdmin,
  postUpdate,
  scheduleWindow,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

interface Overview {
  activeIncidents: { id: string }[]
  liveMaintenance: { id: string }[]
  upcomingMaintenance: { id: string }[]
  incidentsLast30d: number
  [k: string]: unknown
}

/**
 * The overview, read again if it failed: listStatusIncidents loads each listed
 * incident by id and throws when another test deletes one in between (a race
 * reported with this suite, status.service.ts:936).
 */
async function overview(api: APIRequestContext): Promise<Overview> {
  let result: Overview | null = null
  await expect(async () => {
    const res = await callServerFn<Overview>(api, 'getStatusOverviewAdminFn', undefined, {
      method: 'GET',
    })
    expect(res.ok, res.raw.slice(0, 300)).toBe(true)
    result = res.data
  }).toPass({ timeout: 10_000 })
  return result!
}

test(
  'STA-A-56 the overview reflects the live state',
  { tag: '@nightly' },
  async ({ asPerson, playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    try {
      const svc = await createService(admin, `${marker} Overview`)
      const inc = await createIncident(admin, {
        title: `${marker} open one`,
        services: [[svc.id, 'partial_outage']],
      })
      const running = await scheduleWindow(admin, {
        title: `${marker} running`,
        services: [[svc.id, 'under_maintenance']],
      })
      await postUpdate(admin, running.id, 'in_progress', 'started')
      const upcoming = await scheduleWindow(admin, {
        title: `${marker} upcoming`,
        services: [[svc.id, 'under_maintenance']],
        startMin: 2,
        endMin: 30,
      })

      const after = await overview(admin)
      // The 30-day tile counts every live incident in the workspace, and other
      // workers create and delete theirs meanwhile, so a before/after delta can
      // go either way. Only this test's own open incident is certain: the tile
      // counts at least it.
      expect(after.incidentsLast30d).toBeGreaterThanOrEqual(1)
      expect(after.activeIncidents.map((i) => i.id)).toContain(inc.id)
      expect(after.liveMaintenance.map((i) => i.id)).toContain(running.id)
      expect(after.upcomingMaintenance.map((i) => i.id)).toContain(upcoming.id)

      const ui = await asPerson('contributor')
      await openAdmin(ui, '/admin/status?view=overview')
      await expect(ui.getByText('Visitors currently see')).toBeVisible()
      for (const [card, title] of [
        ['Open incidents', `${marker} open one`],
        ['Maintenance in progress', `${marker} running`],
        ['Upcoming maintenance', `${marker} upcoming`],
      ] as const) {
        await expect(ui.getByRole('heading', { name: card }), card).toBeVisible()
        await expect(ui.getByText(title).first(), title).toBeVisible()
      }
      const upcomingRow = ui
        .locator('div', { has: ui.getByRole('button', { name: `${marker} upcoming` }) })
        .filter({ has: ui.getByRole('button', { name: 'Start now' }) })
        .last()
      await expect(upcomingRow.getByRole('button', { name: 'Start now' })).toBeVisible()
      await expect(ui.getByText(/Incidents, 30 days/)).toBeVisible()
      // Clean up: the upcoming window would otherwise start in two minutes.
      await must(admin, 'deleteStatusIncidentFn', { id: upcoming.id })
    } finally {
      await admin.dispose()
    }
  }
)
