/**
 * Status settings that change what every other test sees: the product flag,
 * publishing, the audience, the email switch and Clear history. These run
 * only in the product-isolated job (E2E_SUPPORT_ISOLATED=1, one worker, own
 * database) and put every setting back.
 *
 * Journeys: STA-A-04, STA-A-61, STA-A-62, STA-P-05, STA-P-06, STA-P-23,
 * STA-P-27, STA-S-08, STA-S-17, STA-S-25.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { restoreSettings, snapshotSettings, withSettings } from '../../support/isolated-settings'
import { supportEnv } from '../../support/env'
import { pollFor, supportDb } from '../../support/db'
import { mailTo, waitForMail } from '../../support/mailpit'
import { waitForEventHandled } from '../../support/bells'
import {
  createIncident,
  createService,
  deleteMadeIncidents,
  mintPortalUser,
  must,
  postUpdate,
  serviceEvents,
  statusBells,
  subscribeAs,
  subscriptionRow,
  unsubscribeAs,
  type PortalUser,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext
let anon: APIRequestContext
let users: PortalUser[] = []

test.beforeEach(async ({ playwright }) => {
  test.skip(!ISOLATED, ISOLATED_SKIP)
  admin = await personApi(playwright, 'admin')
  anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
  users = []
})
test.afterEach(async () => {
  if (!ISOLATED) return
  for (const u of users) {
    await unsubscribeAs(u)
    await u.api.dispose()
  }
  await deleteMadeIncidents(admin)
  await admin.dispose()
  await anon.dispose()
})

const UNPUBLISHED = { metadata: { 'statusSettings.enabled': false } }
const SIGNED_IN_ONLY = { metadata: { 'statusSettings.audience': 'authenticated' } }

async function user(
  playwright: Parameters<typeof mintPortalUser>[0],
  marker: string,
  label: string
) {
  const u = await mintPortalUser(playwright, marker, label)
  users.push(u)
  return u
}

test(
  'STA-A-04 the status admin redirects when the status product is off',
  { tag: ['@nightly', '@isolated'] },
  async ({ asPerson }) => {
    await withSettings({ feature_flags: { statusPage: false } }, async () => {
      const ui = await asPerson('admin')
      await ui.goto('/admin/status')
      await expect(ui).not.toHaveURL(/\/admin\/status/)
      await ui.goto('/admin/settings/status')
      await expect(ui).toHaveURL(/\/admin\/settings\/general/)
    })
  }
)

test(
  'STA-A-61 publish and unpublish from Settings → General',
  { tag: ['@core', '@isolated'] },
  async () => {
    const snapshot = await snapshotSettings(['feature_flags', 'metadata'])
    try {
      await must(admin, 'updateFeatureFlagsFn', { statusPage: false })
      expect((await callServerFn(anon, 'getStatusPageFn', undefined, { method: 'GET' })).code).toBe(
        'STATUS_PAGE_NOT_FOUND'
      )
      // Turning it on also publishes a page that was left unpublished.
      await supportDb()`UPDATE settings SET metadata = jsonb_set(metadata::jsonb, '{statusSettings,enabled}', 'false')::text`
      await must(admin, 'updateFeatureFlagsFn', { statusPage: true })
      const [row] = await supportDb()`SELECT metadata FROM settings LIMIT 1`
      expect(JSON.parse(String(row.metadata)).statusSettings.enabled).toBe(true)
      expect((await callServerFn(anon, 'getStatusPageFn', undefined, { method: 'GET' })).ok).toBe(
        true
      )
    } finally {
      await restoreSettings(snapshot)
    }
  }
)

test(
  'STA-P-05 STA-P-27 an unpublished page is not available, and each public read says so its own way',
  { tag: ['@core', '@isolated'] },
  async ({ page, marker }) => {
    const svc = await createService(admin, `${marker} Hidden`)
    const inc = await createIncident(admin, { title: marker, services: [[svc.id, 'major_outage']] })
    await withSettings(UNPUBLISHED, async () => {
      await page.goto('/status')
      await expect(page.getByText('Status page not available')).toBeVisible()
      await expect(
        page.getByText("This status page isn't published, or you don't have access to view it.")
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go home' })).toBeVisible()
      await page.goto(`/status/${inc.id}`)
      await expect(page.getByRole('heading', { name: 'Incident not found' })).toBeVisible()
      const feed = await anon.get('/status/feed')
      expect(feed.status()).toBe(200)
      expect(await feed.text()).not.toContain('<item>')

      const pageFn = await callServerFn(anon, 'getStatusPageFn', undefined, { method: 'GET' })
      expect(pageFn.code).toBe('STATUS_PAGE_NOT_FOUND')
      const detail = await callServerFn(
        anon,
        'getStatusIncidentPublicFn',
        { id: inc.id },
        { method: 'GET' }
      )
      expect(detail.code).toBe('STATUS_INCIDENT_NOT_FOUND')
      expect(
        await must(anon, 'getStatusUptimeFn', { componentIds: [svc.id] }, { method: 'GET' })
      ).toEqual([])
      expect(await must(anon, 'listStatusHistoryFn', {}, { method: 'GET' })).toEqual({
        items: [],
        nextCursor: null,
        hasMore: false,
      })
      expect(await must(anon, 'listStatusFeedFn', {}, { method: 'GET' })).toEqual([])
    })
  }
)

test(
  'STA-P-06 STA-P-23 a signed-in audience prompts sign-in and hides the feed',
  { tag: ['@core', '@isolated'] },
  async ({ browser, page, playwright, marker }) => {
    const svc = await createService(admin, `${marker} Members`)
    await createIncident(admin, {
      title: `${marker} for members`,
      services: [[svc.id, 'degraded_performance']],
    })
    const u = await user(playwright, marker, 'reader')
    await withSettings(SIGNED_IN_ONLY, async () => {
      await page.goto('/status')
      await expect(page.getByText('Sign in to view status')).toBeVisible()
      await expect(page.getByText('You need to sign in to see this status page.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible()
      const feed = await anon.get('/status/feed')
      expect(feed.status()).toBe(200)
      expect(await feed.text()).not.toContain('<item>')

      const { portalPage } = await import('../../support/widget-portal')
      const signedIn = await portalPage(browser, u)
      await signedIn.goto('/status')
      await expect(signedIn.getByText(`${marker} for members`).first()).toBeVisible()
      await expect(signedIn.getByRole('link', { name: /RSS Feed/ })).toHaveCount(0)
      await signedIn.context().close()
    })
  }
)

test(
  'STA-S-17 the workspace email switch off keeps the bell',
  { tag: ['@nightly', '@isolated'] },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Quiet`)
    const u = await user(playwright, marker, 'quiet')
    await subscribeAs(u)
    await withSettings({ metadata: { 'statusSettings.emailsDisabled': true } }, async () => {
      const inc = await createIncident(admin, {
        title: `${marker} no mail`,
        services: [[svc.id, 'major_outage']],
        notifySubscribers: true,
      })
      await waitForEventHandled(inc.id, { type: 'status.incident_created' })
      const bells = await pollFor('the bell', async () => {
        const rows = await statusBells(u.principalUuid, inc.id)
        return rows.length ? rows : null
      })
      expect(bells).toHaveLength(1)
      expect((await mailTo(u.email)).filter((m) => m.Subject.includes(marker))).toEqual([])
    })
  }
)

test(
  'STA-S-08 subscribing honours the page gate',
  { tag: ['@nightly', '@isolated'] },
  async ({ playwright, marker }) => {
    const u = await user(playwright, marker, 'gated')
    await withSettings(UNPUBLISHED, async () => {
      const res = await callServerFn(u.api, 'subscribeStatusFn', { scope: 'page' })
      expect(res.ok).toBe(false)
      expect(await subscriptionRow(u.principalUuid)).toBeNull()
    })
  }
)

test(
  'STA-S-25 subscribers are not emailed while the page is unpublished',
  { tag: ['@nightly', '@isolated'] },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Launch`)
    const u = await user(playwright, marker, 'early')
    await must(admin, 'addStatusSubscriberFn', { email: u.email })
    await withSettings(UNPUBLISHED, async () => {
      const inc = await createIncident(admin, {
        title: `${marker} prelaunch`,
        services: [[svc.id, 'major_outage']],
        notifySubscribers: true,
      })
      await waitForEventHandled(inc.id, { type: 'status.incident_created' })
    })
    // Published again: a later publish reaches them, bounding the wait.
    await createIncident(admin, {
      title: `${marker} sentinel`,
      services: [[svc.id, 'degraded_performance']],
      notifySubscribers: true,
    })
    await waitForMail({ to: u.email, subject: `${marker} sentinel` })
    expect(
      (await mailTo(u.email)).filter((m) => m.Subject.includes(`${marker} prelaunch`))
    ).toEqual([])
  }
)

test(
  'STA-A-62 clear history removes resolved incidents and keeps open ones',
  { tag: ['@core', '@isolated'] },
  async ({ asPerson, marker }) => {
    const held = await createService(admin, `${marker} Held`)
    const done = await createService(admin, `${marker} Done`)
    const open = await createIncident(admin, {
      title: `${marker} open`,
      services: [[held.id, 'major_outage']],
    })
    const closed = await createIncident(admin, {
      title: `${marker} closed`,
      services: [[done.id, 'major_outage']],
    })
    await postUpdate(admin, closed.id, 'resolved', 'fixed')
    const ui = await asPerson('admin')
    await ui.goto('/admin/settings/status')
    await ui.waitForLoadState('networkidle')
    await ui.getByRole('button', { name: 'Clear history' }).click()
    const confirm = ui.getByRole('alertdialog').or(ui.getByRole('dialog'))
    await expect(confirm.getByText('Delete incident history?')).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete incident history' }).click()
    await pollFor('the history to clear', async () =>
      (await callServerFn(admin, 'getStatusIncidentAdminFn', { id: closed.id }, { method: 'GET' }))
        .data === null
        ? true
        : null
    )
    expect(
      (await callServerFn(admin, 'getStatusIncidentAdminFn', { id: open.id }, { method: 'GET' }))
        .data
    ).not.toBeNull()
    expect(await serviceEvents(done.id)).toEqual([])
  }
)

test(
  'STA-A-62 clear history keeps the events behind statuses still held',
  {
    tag: ['@nightly', '@isolated', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'clearStatusHistory (status.service.ts:792) deletes every service event, including those behind statuses open incidents still hold, so uptime reads operational for services that are down; see QUARANTINE.md',
    },
  },
  async ({ marker }) => {
    const held = await createService(admin, `${marker} Held`)
    const done = await createService(admin, `${marker} Done`)
    const open = await createIncident(admin, {
      title: `${marker} open`,
      services: [[held.id, 'major_outage']],
    })
    const closed = await createIncident(admin, {
      title: `${marker} closed`,
      services: [[done.id, 'major_outage']],
    })
    await postUpdate(admin, closed.id, 'resolved', 'fixed')
    await must(admin, 'clearStatusHistoryFn')
    // The resolved incident is gone; the open one and its hold remain.
    expect(
      (await callServerFn(admin, 'getStatusIncidentAdminFn', { id: closed.id }, { method: 'GET' }))
        .data
    ).toBeNull()
    expect(
      (await callServerFn(admin, 'getStatusIncidentAdminFn', { id: open.id }, { method: 'GET' }))
        .data
    ).not.toBeNull()
    expect((await serviceEvents(held.id)).at(-1)?.status).toBe('major_outage')
  }
)
