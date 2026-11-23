/**
 * Status admin: who can open what, and the server's refusals behind it.
 *
 * Journeys: STA-A-01, STA-A-02, STA-A-03, STA-A-05.
 *
 * Seeded people: `admin` holds status_page.publish and status_page.manage;
 * `contributor` holds publish only; `noAccess` holds neither. A manage-only
 * teammate is made per test with its own custom role.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { newTeammate } from '../../support/api-client'
import { mintSession } from '../../support/teammates'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import {
  createIncident,
  createService,
  incidentRow,
  must,
  openAdmin,
  postUpdate,
  scheduleWindow,
  serviceRow,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
})
test.afterEach(async () => {
  await admin.dispose()
})

const DENIED = (perm: string) =>
  new RegExp(`Access denied: Requires permission '${perm.replace('.', '\\.')}'`)

/** A fresh teammate holding exactly `permissions`, signed in. */
async function teammateWith(
  playwright: Parameters<typeof personApi>[0],
  marker: string,
  permissions: string[]
) {
  const t = newTeammate(`${marker} status`, permissions)
  const storageState = await mintSession(t.userId)
  const api = await playwright.request.newContext({
    baseURL: supportEnv().baseUrl,
    storageState,
  })
  return { ...t, storageState, api }
}

test(
  'STA-A-01 the status admin opens on the right default view per role',
  { tag: '@core' },
  async ({ asPerson, browser, playwright, marker }) => {
    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/status')
    await expect(ui.getByRole('button', { name: 'Overview', exact: true })).toBeVisible()
    await expect(ui.getByText('Visitors currently see')).toBeVisible()

    const contributor = await asPerson('contributor')
    await openAdmin(contributor, '/admin/status')
    await expect(contributor.getByText('Visitors currently see')).toBeVisible()
    await expect(contributor.getByRole('button', { name: /^Services/ })).toHaveCount(0)
    await expect(contributor.getByRole('link', { name: 'Status' })).toBeVisible()

    // Manage only: lands on Services; the nav still shows Status.
    const manager = await teammateWith(playwright, marker, ['status_page.manage'])
    const context = await browser.newContext({ storageState: manager.storageState })
    try {
      const page = await context.newPage()
      await openAdmin(page, '/admin/status')
      await expect(page.getByPlaceholder('Search services…')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Status' })).toBeVisible()
    } finally {
      await context.close()
      await manager.api.dispose()
    }
  }
)

test(
  'STA-A-02 a teammate with no status permission is shut out',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const ui = await asPerson('noAccess')
    await openAdmin(ui, '/admin/status')
    await expect(ui.getByText("You don't have access to the status page")).toBeVisible()
    await expect(
      ui.getByText(
        'The status page needs the status_page.publish permission to run incidents, or status_page.manage to manage the page. Ask a workspace admin to add one to your role.'
      )
    ).toBeVisible()

    const svc = await createService(admin, `${marker} Locked`)
    const api = await personApi(playwright, 'noAccess')
    try {
      const overview = await callServerFn(api, 'getStatusOverviewAdminFn', undefined, {
        method: 'GET',
      })
      expect(overview.ok).toBe(false)
      expect(overview.raw).toMatch(DENIED('status_page.publish'))
      const create = await callServerFn(api, 'createStatusIncidentFn', {
        kind: 'incident',
        title: marker,
        status: 'investigating',
        body: 'x',
        affectedComponents: [{ componentId: svc.id, componentStatus: 'major_outage' }],
      })
      expect(create.ok).toBe(false)
      expect(create.raw).toMatch(DENIED('status_page.publish'))
      const list = await callServerFn(api, 'listStatusComponentsAdminFn', undefined, {
        method: 'GET',
      })
      expect(list.ok).toBe(false)
      expect(list.raw).toMatch(DENIED('status_page.manage'))
    } finally {
      await api.dispose()
    }
    // Nothing was written.
    const rows = await supportDb()`SELECT 1 FROM status_incidents WHERE title = ${marker}`
    expect(rows).toHaveLength(0)
    expect((await serviceRow(svc.id)).status).toBe('operational')
  }
)

test(
  'STA-A-03 a publish-only teammate runs incidents but cannot reshape the page',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const svc = await createService(admin, `${marker} Contrib`)
    const api = await personApi(playwright, 'contributor')
    try {
      // Every incident action works, delete included.
      const inc = await createIncident(api, { title: marker, services: [[svc.id, 'major_outage']] })
      await must(api, 'updateStatusIncidentFn', { id: inc.id, title: `${marker} renamed` })
      await postUpdate(api, inc.id, 'identified', 'found it')
      await must(api, 'listStatusIncidentTemplatesFn', undefined, { method: 'GET' })
      const w = await scheduleWindow(api, {
        title: `${marker} window`,
        services: [[svc.id, 'under_maintenance']],
      })
      await must(api, 'startStatusMaintenanceNowFn', { id: w.id })
      const choices = await must<{
        ungrouped: { id: string }[]
        groups: { components: { id: string }[] }[]
      }>(api, 'listStatusComponentChoicesFn', undefined, { method: 'GET' })
      expect(
        [...choices.ungrouped, ...choices.groups.flatMap((g) => g.components)].map((c) => c.id)
      ).toContain(svc.id)
      await must(api, 'deleteStatusIncidentFn', { id: inc.id })
      expect((await incidentRow(inc.id)).deleted_at).not.toBeNull()
      await must(api, 'deleteStatusIncidentFn', { id: w.id })

      // Every manage-only fn is refused.
      const manageOnly: [string, unknown, 'GET' | 'POST'][] = [
        ['createStatusComponentFn', { name: `${marker} nope` }, 'POST'],
        ['setStatusComponentStatusFn', { id: svc.id, status: 'major_outage' }, 'POST'],
        ['createStatusGroupFn', { name: `${marker} nope` }, 'POST'],
        ['createStatusIncidentTemplateFn', { name: marker, title: marker, body: 'x' }, 'POST'],
        [
          'updateStatusIncidentTemplateFn',
          { id: 'status_tmpl_01m7v6aewge02vtv3kd36ggmcw', name: 'x' },
          'POST',
        ],
        [
          'deleteStatusIncidentTemplateFn',
          { id: 'status_tmpl_01m7v6aewge02vtv3kd36ggmcw' },
          'POST',
        ],
        ['addStatusSubscriberFn', { email: `${marker}@customers.example` }, 'POST'],
        ['importStatusSubscribersFn', { emails: [`${marker}@customers.example`] }, 'POST'],
        ['exportStatusSubscribersAdminFn', undefined, 'GET'],
        ['updateStatusSettingsFn', { pageDescription: marker }, 'POST'],
        ['clearStatusHistoryFn', undefined, 'POST'],
        ['getStatusUptimeAdminFn', { componentIds: [svc.id] }, 'GET'],
      ]
      for (const [name, data, method] of manageOnly) {
        const res = await callServerFn(api, name, data, { method })
        expect(res.ok, name).toBe(false)
        expect(res.raw, name).toMatch(DENIED('status_page.manage'))
      }
      expect((await serviceRow(svc.id)).status).toBe('operational')
      const groups =
        await supportDb()`SELECT 1 FROM status_component_groups WHERE name = ${`${marker} nope`}`
      expect(groups).toHaveLength(0)
    } finally {
      await api.dispose()
    }

    const ui = await asPerson('contributor')
    for (const view of ['components', 'subscribers']) {
      await openAdmin(ui, `/admin/status?view=${view}`)
      await expect(ui.getByText("You don't have access to this")).toBeVisible()
      await expect(
        ui.getByText(
          'Managing services and subscribers needs the status_page.manage permission. Ask a workspace admin to add it to your role.'
        )
      ).toBeVisible()
    }
  }
)

test(
  'STA-A-05 the status settings page needs status_page.manage',
  { tag: '@nightly' },
  async ({ asPerson, playwright }) => {
    const contributor = await asPerson('contributor')
    await contributor.goto('/admin/settings/status')
    await expect(contributor).not.toHaveURL(/\/admin\/settings\/status/)
    await expect(contributor).toHaveURL(/not_team_member/)
    const api = await personApi(playwright, 'contributor')
    try {
      const res = await callServerFn(api, 'getStatusSettingsFn', undefined, { method: 'GET' })
      expect(res.ok).toBe(false)
      expect(res.raw).toMatch(DENIED('status_page.manage'))
    } finally {
      await api.dispose()
    }

    const ui = await asPerson('admin')
    await openAdmin(ui, '/admin/settings/status')
    for (const title of ['Page', 'Visibility', 'Notifications', 'Danger zone']) {
      await expect(ui.getByText(title, { exact: true }).first(), title).toBeVisible()
    }
    await expect(ui.getByText(/Sent from/).first()).toBeVisible()
  }
)
