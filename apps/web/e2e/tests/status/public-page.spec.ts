/**
 * The public status page and incident pages, as visitors see them.
 *
 * Journeys: STA-P-01, STA-P-02, STA-P-03, STA-P-04, STA-P-08, STA-P-10,
 * STA-P-11, STA-P-12, STA-P-13, STA-P-14, STA-P-15, STA-P-19, STA-P-28.
 *
 * The hero, the "No incidents" line and the feed cap are workspace-wide, so
 * these assert only on this test's own services and incidents.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import {
  createIncident,
  createSegment,
  createService,
  mintPortalUser,
  must,
  postUpdate,
  publicServiceIds,
  publicSnapshot,
  recentIds,
  scheduleWindow,
  type PublicSnapshot,
  deleteMadeIncidents,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext
let anon: APIRequestContext

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
  anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
})
test.afterEach(async () => {
  await deleteMadeIncidents(admin)
  await admin.dispose()
  await anon.dispose()
})

/** A service row on the public page: its name and status label. */
function serviceRowOn(page: Page, name: string) {
  return page.locator('div.justify-between', { has: page.getByText(name, { exact: true }) })
}

const uuidOf = (typeId: string) => toUuid(typeId as `status_component_${string}`)

test(
  'STA-P-01 an anonymous visitor opens the published status page',
  { tag: '@core' },
  async ({ page, marker }) => {
    const group = await must<{ id: string }>(admin, 'createStatusGroupFn', {
      name: `${marker} Group`,
      collapsed: true,
    })
    await createService(admin, `${marker} In group`, { groupId: group.id })
    const loose = await createService(admin, `${marker} Loose`)
    await must(admin, 'setStatusComponentStatusFn', {
      id: loose.id,
      status: 'degraded_performance',
    })

    const res = await page.goto('/status')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveTitle(/^Status - /)
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(/\/status$/)
    await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Subscribe' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /RSS Feed/ })).toBeVisible()
    await expect(page.getByText('Current status by service')).toBeVisible()
    await expect(serviceRowOn(page, `${marker} Loose`)).toContainText('Degraded performance')
    // The collapsed group is closed: its service is not listed until opened.
    const groupHeader = page.getByRole('button', { name: new RegExp(`${marker} Group`) })
    await expect(groupHeader).toBeVisible()
    await expect(page.getByText(`${marker} In group`, { exact: true })).toBeHidden()
    // A click before hydration is lost: retry until the group opens.
    await page.waitForLoadState('networkidle')
    await expect(async () => {
      await groupHeader.click()
      await expect(serviceRowOn(page, `${marker} In group`)).toContainText('Operational', {
        timeout: 2_000,
      })
    }).toPass({ timeout: 15_000 })
  }
)

test('STA-P-02 an active incident shows as a card', { tag: '@core' }, async ({ page, marker }) => {
  const svc = await createService(admin, `${marker} Card`)
  const inc = await createIncident(admin, {
    title: `${marker} card incident`,
    services: [[svc.id, 'major_outage']],
    body: `${marker} latest words`,
  })
  await page.goto('/status')
  const card = page.getByRole('link', { name: new RegExp(`${marker} card incident`) })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Investigating')
  await expect(card).toContainText('Critical impact')
  await expect(card).toContainText(`${marker} Card`)
  await expect(card).toContainText(`${marker} latest words`)
  await expect(card).toContainText('Last update')
  await expect(serviceRowOn(page, `${marker} Card`)).toContainText('Major outage')
  expect((await publicSnapshot(anon)).activeIncidents.map((i) => i.id)).toContain(inc.id)
})

test('STA-P-03 the incident detail page', { tag: '@core' }, async ({ page, marker }) => {
  const svc = await createService(admin, `${marker} Detail`)
  const inc = await createIncident(admin, {
    title: `${marker} detail incident`,
    services: [[svc.id, 'partial_outage']],
    body: `${marker} first`,
  })
  await postUpdate(admin, inc.id, 'identified', `${marker} second`)
  const res = await page.goto(`/status/${inc.id}`)
  expect(res?.headers()['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=600')
  await expect(page).toHaveTitle(new RegExp(`^${marker} detail incident - .* Status$`))
  await expect(
    page.getByRole('heading', { level: 1, name: `${marker} detail incident` })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Status' }).first()).toBeVisible()
  await expect(page.getByText('Major impact').first()).toBeVisible()
  await expect(page.getByText(/^Started /)).toBeVisible()
  await expect(page.getByText('Affected:')).toBeVisible()
  await expect(page.getByText('Updates', { exact: true })).toBeVisible()
  // The server sends the timeline oldest first; the page shows the newest on top.
  const first = page.getByText(`${marker} first`)
  const second = page.getByText(`${marker} second`)
  await expect(first).toBeVisible()
  const [y1, y2] = [await first.boundingBox(), await second.boundingBox()]
  expect(y2!.y).toBeLessThan(y1!.y)
})

test(
  'STA-P-04 the incident page for a missing, deleted, gated or malformed id',
  { tag: '@core' },
  async ({ page, marker }) => {
    const svc = await createService(admin, `${marker} Del`)
    const deleted = await createIncident(admin, {
      title: marker,
      services: [[svc.id, 'degraded_performance']],
    })
    await must(admin, 'deleteStatusIncidentFn', { id: deleted.id })
    const segment = await createSegment(marker)
    const gatedSvc = await createService(admin, `${marker} Gated`, { segmentIds: [segment.id] })
    const gated = await createIncident(admin, {
      title: `${marker} gated`,
      services: [[gatedSvc.id, 'major_outage']],
    })

    for (const id of [
      deleted.id,
      'status_incident_01m7v6aewge02vtv3kd36ggmcw',
      'garbage',
      gated.id,
    ]) {
      await page.goto(`/status/${id}`)
      await expect(page.getByRole('heading', { name: 'Incident not found' }), id).toBeVisible()
      await expect(
        page.getByText("This incident may have been removed, or you don't have access to view it.")
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'Status' }).first()).toBeVisible()
    }
    for (const id of [gated.id, deleted.id]) {
      const res = await callServerFn(anon, 'getStatusIncidentPublicFn', { id }, { method: 'GET' })
      expect(res.code, id).toBe('STATUS_INCIDENT_NOT_FOUND')
    }
  }
)

test(
  'STA-P-08 segment-gated services and incidents per viewer',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const member = await mintPortalUser(playwright, marker, 'member')
    const outsider = await mintPortalUser(playwright, marker, 'outsider')
    try {
      const segment = await createSegment(marker, [member.principalUuid])
      const g = await createService(admin, `${marker} G`, { segmentIds: [segment.id] })
      const p = await createService(admin, `${marker} P`)
      const onlyG = await createIncident(admin, {
        title: `${marker} only G`,
        services: [[g.id, 'major_outage']],
      })
      const both = await createIncident(admin, {
        title: `${marker} both`,
        services: [
          [g.id, 'major_outage'],
          [p.id, 'degraded_performance'],
        ],
      })
      const view = async (api: APIRequestContext) => {
        const snap: PublicSnapshot = await publicSnapshot(api)
        const active = snap.activeIncidents as unknown as {
          id: string
          impact: string
          affectedComponents: { id: string }[]
        }[]
        return { snap, active, both: active.find((i) => i.id === both.id) }
      }
      for (const api of [anon, outsider.api]) {
        const { snap, active, both: b } = await view(api)
        expect(publicServiceIds(snap)).not.toContain(g.id)
        expect(active.map((i) => i.id)).not.toContain(onlyG.id)
        expect(b?.impact).toBe('minor')
        expect(b?.affectedComponents.map((c) => c.id)).toEqual([p.id])
        const detail = await callServerFn(
          api,
          'getStatusIncidentPublicFn',
          { id: onlyG.id },
          { method: 'GET' }
        )
        expect(detail.code).toBe('STATUS_INCIDENT_NOT_FOUND')
      }
      for (const api of [member.api, admin]) {
        const { snap, active, both: b } = await view(api)
        expect(publicServiceIds(snap)).toContain(g.id)
        expect(active.map((i) => i.id)).toContain(onlyG.id)
        expect(b?.impact).toBe('critical')
        expect(b?.affectedComponents.map((c) => c.id).sort()).toEqual([g.id, p.id].sort())
      }
    } finally {
      await member.api.dispose()
      await outsider.api.dispose()
    }
  }
)

test(
  'STA-P-10 STA-P-11 scheduled maintenance, then in progress',
  { tag: '@core' },
  async ({ page, marker }) => {
    const svc = await createService(admin, `${marker} Maint`)
    const w = await scheduleWindow(admin, {
      title: `${marker} window`,
      services: [[svc.id, 'under_maintenance']],
      body: `${marker} plan`,
      startMin: 600,
      endMin: 660,
    })
    await page.goto('/status')
    await expect(page.getByText('Scheduled maintenance', { exact: true })).toBeVisible()
    const row = page
      .locator('div', { has: page.getByRole('link', { name: `${marker} window` }) })
      .filter({ hasText: `${marker} plan` })
      .last()
    await expect(page.getByRole('link', { name: `${marker} window` })).toBeVisible()
    await expect(row).toContainText('Scheduled')
    await expect(row).toContainText(`${marker} plan`)
    await expect(serviceRowOn(page, `${marker} Maint`)).toContainText('Operational')

    await must(admin, 'startStatusMaintenanceNowFn', { id: w.id })
    await page.goto('/status')
    const card = page.getByRole('link', { name: new RegExp(`${marker} window`) })
    await expect(card).toContainText('In progress')
    await expect(card).toContainText('Maintenance')
    await expect(serviceRowOn(page, `${marker} Maint`)).toContainText('Under maintenance')
    const snap = await publicSnapshot(anon)
    expect(snap.upcomingMaintenance.map((x) => x.id)).not.toContain(w.id)
    await page.goto(`/status/${w.id}`)
    await expect(page.getByText(/^Scheduled window: /)).toBeVisible()
  }
)

test('STA-P-12 recent incidents grouped by UTC day', { tag: '@nightly' }, async ({ marker }) => {
  const svc = await createService(admin, `${marker} Recent`)
  const today = await createIncident(admin, {
    title: `${marker} today`,
    services: [[svc.id, 'degraded_performance']],
  })
  await postUpdate(admin, today.id, 'resolved', 'done')
  const older = await createIncident(admin, {
    title: `${marker} older`,
    services: [[svc.id, 'degraded_performance']],
  })
  await postUpdate(admin, older.id, 'resolved', 'done')
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
  await supportDb()`UPDATE status_incidents SET started_at = ${threeDaysAgo} WHERE id = ${uuidOf(older.id)}`
  const w = await scheduleWindow(admin, {
    title: `${marker} window`,
    services: [[svc.id, 'under_maintenance']],
  })
  await postUpdate(admin, w.id, 'in_progress', 'go')
  await postUpdate(admin, w.id, 'completed', 'done')

  const snap = await publicSnapshot(anon)
  const dayOf = (id: string) =>
    snap.recentIncidents.find((d) => d.incidents.some((i) => i.id === id))?.date
  const isoDay = (d: Date) => d.toISOString().slice(0, 10)
  expect(dayOf(today.id)?.slice(0, 10)).toBe(isoDay(new Date()))
  expect(dayOf(older.id)?.slice(0, 10)).toBe(isoDay(threeDaysAgo))
  const dates = snap.recentIncidents.map((d) => d.date)
  expect([...dates].sort().reverse()).toEqual(dates)
  expect(recentIds(snap)).not.toContain(w.id)
  const again = await publicSnapshot(anon)
  expect((again as unknown as { recentWindow: { start: string } }).recentWindow.start).toBe(
    (snap as unknown as { recentWindow: { start: string } }).recentWindow.start
  )
})

test(
  'STA-P-13 incident history pages past the recent window',
  { tag: '@nightly' },
  async ({ page, marker }) => {
    const svc = await createService(admin, `${marker} History`)
    const old = await createIncident(admin, {
      title: `${marker} twenty days ago`,
      status: 'resolved',
      services: [[svc.id, 'major_outage']],
      backfill: {
        startedAt: new Date(Date.now() - 20 * 86_400_000),
        resolvedAt: new Date(Date.now() - 20 * 86_400_000 + 3_600_000),
      },
    })
    const w = await scheduleWindow(admin, {
      title: `${marker} done window`,
      services: [[svc.id, 'under_maintenance']],
    })
    await postUpdate(admin, w.id, 'in_progress', 'go')
    await postUpdate(admin, w.id, 'completed', 'done')

    const snap = await publicSnapshot(anon)
    const before = (snap as unknown as { recentWindow: { start: string } }).recentWindow.start
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 50; i++) {
      const res = await must<{
        items: { id: string }[]
        nextCursor: string | null
        hasMore: boolean
      }>(anon, 'listStatusHistoryFn', { before, ...(cursor ? { cursor } : {}) }, { method: 'GET' })
      seen.push(...res.items.map((x) => x.id))
      if (seen.includes(old.id) && seen.includes(w.id)) break
      if (!res.hasMore || !res.nextCursor) break
      cursor = res.nextCursor
    }
    expect(seen).toContain(old.id)
    expect(seen).toContain(w.id)
    await page.goto('/status')
    await expect(page.getByRole('button', { name: 'Incident history →' })).toBeVisible()
  }
)

test('STA-P-14 uptime bars', { tag: '@core' }, async ({ page, marker }) => {
  const s = await createService(admin, `${marker} S`)
  const m = await createService(admin, `${marker} M`)
  const h = await createService(admin, `${marker} H`, { showUptime: false })
  const now = new Date()
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  )
  const at = (hours: number) => new Date(yesterday.getTime() + hours * 3_600_000)
  const sql = supportDb()
  for (const svc of [s, m, h]) {
    await sql`UPDATE status_components SET created_at = ${new Date(yesterday.getTime() - 86_400_000)}
      WHERE id = ${uuidOf(svc.id)}`
  }
  const event = (id: string, status: string, when: Date) =>
    sql`INSERT INTO status_component_events (id, component_id, status, source, created_at)
        VALUES (gen_random_uuid(), ${uuidOf(id)}, ${status}, 'manual', ${when})`
  await event(s.id, 'major_outage', at(0))
  await event(s.id, 'operational', at(6))
  await event(m.id, 'under_maintenance', at(0))
  await event(m.id, 'operational', at(24))

  const payload = await must<{
    uptime: {
      componentId: string
      days: { date: string; worstStatus: string; uptimePct: number }[]
    }[]
  }>(anon, 'getStatusPageFn', undefined, { method: 'GET' })
  const dayOf = (id: string) =>
    payload.uptime
      .find((u) => u.componentId === id)
      ?.days.find((d) => d.date === yesterday.toISOString().slice(0, 10))
  expect(dayOf(s.id)).toMatchObject({ worstStatus: 'major_outage', uptimePct: 75 })
  expect(dayOf(m.id)?.uptimePct).toBe(100)
  expect(payload.uptime.map((u) => u.componentId)).not.toContain(h.id)
  const twoDaysBack = payload.uptime
    .find((u) => u.componentId === s.id)
    ?.days.find(
      (d) => d.date === new Date(yesterday.getTime() - 5 * 86_400_000).toISOString().slice(0, 10)
    )
  expect(twoDaysBack).toMatchObject({ worstStatus: 'operational', uptimePct: 100 })

  await page.goto('/status')
  await expect(page.getByLabel(`${marker} S uptime, last 90 days`)).toBeVisible()
  await expect(page.getByLabel(new RegExp(`: Major outage, 75%$`)).first()).toBeAttached()
  await expect(page.getByLabel(`${marker} H uptime, last 90 days`)).toHaveCount(0)
})

test(
  'STA-P-15 uptime follows a status that has no history row',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'createStatusComponent writes no status_component_events row for a non-operational initial status (status.components.ts:176), and uptime starts from operational when no event exists; see QUARANTINE.md',
    },
  },
  async ({ marker }) => {
    const svc = await createService(admin, `${marker} Born down`, { status: 'major_outage' })
    const payload = await must<{
      uptime: { componentId: string; days: { worstStatus: string; uptimePct: number }[] }[]
    }>(anon, 'getStatusPageFn', undefined, { method: 'GET' })
    const today = payload.uptime.find((u) => u.componentId === svc.id)?.days.at(-1)
    expect(today?.worstStatus).toBe('major_outage')
  }
)

test(
  'STA-P-19 public status documents are cached for anonymous visitors only',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Cache`)
    const inc = await createIncident(admin, {
      title: marker,
      services: [[svc.id, 'degraded_performance']],
    })
    const header = 'public, s-maxage=60, stale-while-revalidate=600'
    for (const path of ['/status', `/status/${inc.id}`]) {
      const res = await anon.get(path)
      expect(res.headers()['cache-control'], path).toBe(header)
    }
    const user = await mintPortalUser(playwright, marker)
    try {
      for (const path of ['/status', `/status/${inc.id}`]) {
        const res = await user.api.get(path)
        expect(res.status()).toBe(200)
        expect(res.headers()['cache-control'] ?? '', path).not.toBe(header)
      }
    } finally {
      await user.api.dispose()
    }
  }
)

test(
  'STA-P-28 teammates see the whole page on the portal',
  { tag: '@nightly' },
  async ({ asPerson, marker }) => {
    const segment = await createSegment(marker)
    const g = await createService(admin, `${marker} Team only`, { segmentIds: [segment.id] })
    const inc = await createIncident(admin, {
      title: `${marker} team incident`,
      services: [[g.id, 'major_outage']],
    })
    const ui = await asPerson('contributor')
    await ui.goto('/status')
    await expect(serviceRowOn(ui, `${marker} Team only`)).toContainText('Major outage')
    await ui.goto(`/status/${inc.id}`)
    await expect(
      ui.getByRole('heading', { level: 1, name: `${marker} team incident` })
    ).toBeVisible()
    await expect(ui.getByText('Critical impact').first()).toBeVisible()
  }
)
