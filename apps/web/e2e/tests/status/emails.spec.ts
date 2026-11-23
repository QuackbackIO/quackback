/**
 * Status publish emails and bells: who gets them, what they say, and the ways
 * to stop them.
 *
 * Journeys: STA-S-10, STA-S-11, STA-S-12, STA-S-13, STA-S-14, STA-S-15,
 * STA-S-16, STA-S-19, STA-S-20, STA-S-21, STA-S-22, STA-S-23, STA-S-24,
 * STA-S-26, STA-S-29, STA-S-30.
 *
 * A publish emails every matching subscriber in the workspace, so each test
 * subscribes its own fresh people, finds mail by recipient and a marker in the
 * subject, and unsubscribes them at the end. "Gets nothing" is always proved
 * against a later mail or bell the same person (or a sibling) must get.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { pollFor, supportDb } from '../../support/db'
import {
  getMailHeaders,
  linksIn,
  mailTo,
  waitForEmailLog,
  waitForMail,
} from '../../support/mailpit'
import { waitForEventHandled } from '../../support/bells'
import { blockPrincipal } from '../../support/email-journeys'
import { runSweep } from '../../support/sweeps'
import {
  createIncident,
  createSegment,
  createService,
  deleteMadeIncidents,
  domainEvents,
  incidentRow,
  mintPortalUser,
  must,
  openAdmin,
  postUpdate,
  statusBells,
  subscribeAs,
  unsubscribeAs,
  type PortalUser,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext
let users: PortalUser[] = []

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
  users = []
})
test.afterEach(async () => {
  for (const u of users) {
    await unsubscribeAs(u)
    await u.api.dispose()
  }
  await deleteMadeIncidents(admin)
  await admin.dispose()
})

async function subscriber(
  playwright: Parameters<typeof mintPortalUser>[0],
  marker: string,
  label: string,
  scope: 'page' | 'components' = 'page',
  componentIds: string[] = []
): Promise<PortalUser> {
  const u = await mintPortalUser(playwright, marker, label)
  users.push(u)
  await subscribeAs(u, scope, componentIds)
  return u
}

const mailsWith = async (to: string, subject: string) =>
  (await mailTo(to)).filter((m) => m.Subject.includes(subject))

const text = (m: { Text: string }) => m.Text.replace(/\s+/g, ' ')

/** Publish a notifying incident and wait until its fan-out is done. */
async function publish(
  title: string,
  services: [string, Parameters<typeof createIncident>[1]['services'][0][1]][]
) {
  const inc = await createIncident(admin, { title, services, notifySubscribers: true })
  await waitForEventHandled(inc.id, { type: 'status.incident_created' })
  return inc
}

test(
  'STA-S-10 an incident publish emails page-wide subscribers',
  { tag: '@smoke' },
  async ({ playwright, marker }) => {
    const a = await createService(admin, `${marker} Web`)
    const b = await createService(admin, `${marker} Db`)
    const sub = await subscriber(playwright, marker, 'page')
    const inc = await createIncident(admin, {
      title: `${marker} outage`,
      body: `${marker} line one\nline two`,
      services: [
        [a.id, 'degraded_performance'],
        [b.id, 'major_outage'],
      ],
      notifySubscribers: true,
    })
    const mail = await waitForMail({ to: sub.email, subject: `Incident: ${marker} outage` })
    expect(mail.Subject).toBe(`Incident: ${marker} outage`)
    const body = text(mail)
    expect(body).toMatch(/New incident reported/i)
    expect(body).toContain('just posted an update to its status page.')
    expect(body).toContain('Critical impact · Investigating')
    expect(body).toContain(`${marker} line one`)
    expect(body).toContain('Affected services')
    expect(body).toContain(`${marker} Web: Degraded performance`)
    expect(body).toContain(`${marker} Db: Major outage`)
    expect(body).toContain("You received this email because you're subscribed to status updates.")
    const links = linksIn(mail)
    expect(links.some((l) => l.endsWith(`/status/${inc.id}`))).toBe(true)
    expect(links.some((l) => /\/unsubscribe\?token=[0-9a-f-]{36}/.test(l))).toBe(true)
    const headers = await getMailHeaders(mail.ID)
    expect(headers['List-Unsubscribe']?.[0]).toMatch(/unsubscribe\?token=/)
    await waitForEmailLog(sub.email, { email_type: 'StatusIncidentPublishedEmail' })
  }
)

test(
  'STA-S-11 an incident publish rings a bell for subscribers only',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Bell`)
    const sub = await subscriber(playwright, marker, 'bell')
    const other = await mintPortalUser(playwright, marker, 'none')
    users.push(other)
    const inc = await publish(`${marker} bell incident`, [[svc.id, 'major_outage']])
    const bells = await pollFor('the bell', async () => {
      const rows = await statusBells(sub.principalUuid, inc.id)
      return rows.length ? rows : null
    })
    expect(bells).toEqual([
      expect.objectContaining({
        type: 'status_incident',
        title: `New incident: ${marker} bell incident`,
        body: 'Investigating',
      }),
    ])
    const [meta] = await supportDb()<{ metadata: Record<string, unknown> }[]>`
    SELECT metadata FROM in_app_notifications
    WHERE principal_id = ${sub.principalUuid} AND metadata::text LIKE ${`%${inc.id}%`}`
    expect(meta.metadata).toMatchObject({
      incidentId: inc.id,
      incidentTitle: `${marker} bell incident`,
      kind: 'incident',
      impact: 'critical',
    })
    // The fan-out is done (waitForEventHandled): a non-subscriber has none.
    expect(await statusBells(other.principalUuid, inc.id)).toEqual([])
  }
)

test(
  'STA-S-12 a scheduled window emails and rings subscribers',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Maint`)
    const sub = await subscriber(playwright, marker, 'maint')
    const day = new Date(Date.now() + 2 * 86_400_000)
    const start = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 2, 0)
    )
    const end = new Date(start.getTime() + 2 * 3_600_000)
    const w = await createIncident(admin, {
      kind: 'maintenance',
      title: `${marker} upgrade`,
      body: `${marker} planned work`,
      services: [[svc.id, 'under_maintenance']],
      scheduledStartAt: start,
      scheduledEndAt: end,
      notifySubscribers: true,
    })
    const mail = await waitForMail({
      to: sub.email,
      subject: `Scheduled maintenance: ${marker} upgrade`,
    })
    const body = text(mail)
    expect(body).toContain('has scheduled maintenance that may affect its services.')
    expect(body).toContain(`${marker} planned work`)
    expect(body).toContain('Maintenance window')
    const dateWords = start.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
    expect(body).toContain(`${dateWords} at 02:00 UTC`)
    expect(body).toContain('04:00 UTC')
    expect(body).toContain(`${marker} Maint`)
    expect(linksIn(mail).some((l) => l.endsWith(`/status/${w.id}`))).toBe(true)
    const bells = await pollFor('the bell', async () => {
      const rows = await statusBells(sub.principalUuid, w.id)
      return rows.length ? rows : null
    })
    expect(bells).toEqual([
      expect.objectContaining({
        title: `Scheduled maintenance: ${marker} upgrade`,
        body: 'Scheduled',
      }),
    ])
  }
)

test(
  'STA-S-13 updates, resolve, start and complete never email or ring',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Quiet`)
    const sub = await subscriber(playwright, marker, 'quiet')
    const inc = await publish(`${marker} quiet incident`, [[svc.id, 'major_outage']])
    await waitForMail({ to: sub.email, subject: `${marker} quiet incident` })
    await postUpdate(admin, inc.id, 'identified', 'found')
    await postUpdate(admin, inc.id, 'resolved', 'fixed')
    await postUpdate(admin, inc.id, 'investigating', 'back')
    const w = await createIncident(admin, {
      kind: 'maintenance',
      title: `${marker} quiet window`,
      services: [[svc.id, 'under_maintenance']],
      scheduledStartAt: new Date(Date.now() + 3_600_000),
      scheduledEndAt: new Date(Date.now() + 7_200_000),
      notifySubscribers: true,
    })
    await waitForMail({ to: sub.email, subject: `${marker} quiet window` })
    await must(admin, 'startStatusMaintenanceNowFn', { id: w.id })
    await postUpdate(admin, w.id, 'completed', 'done')
    for (const id of [inc.id, w.id]) {
      for (const type of [
        'status.incident_updated',
        'status.maintenance_started',
        'status.maintenance_completed',
      ]) {
        if ((await domainEvents(id)).some((e) => e.type === type))
          await waitForEventHandled(id, { type })
      }
    }
    // A later publish the subscriber does get bounds the wait.
    await publish(`${marker} sentinel`, [[svc.id, 'degraded_performance']])
    await waitForMail({ to: sub.email, subject: `${marker} sentinel` })
    expect(await mailsWith(sub.email, `${marker} quiet incident`)).toHaveLength(1)
    expect(await mailsWith(sub.email, `${marker} quiet window`)).toHaveLength(1)
    expect(await statusBells(sub.principalUuid, inc.id)).toHaveLength(1)
    expect(await statusBells(sub.principalUuid, w.id)).toHaveLength(1)
  }
)

test(
  'STA-S-14 publishing with "Email subscribers" off sends nothing',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const svc = await createService(admin, `${marker} Off`)
    const sub = await subscriber(playwright, marker, 'off')
    const inc = await createIncident(admin, {
      title: `${marker} silent`,
      services: [[svc.id, 'major_outage']],
      notifySubscribers: false,
    })
    const row = await incidentRow(inc.id)
    expect(row.notify_subscribers).toBe(false)
    expect(row.notified_at).not.toBeNull()
    await waitForEventHandled(inc.id, { type: 'status.incident_created' })
    const created = (await domainEvents(inc.id)).find((e) => e.type === 'status.incident_created')
    expect(created?.payload).toMatchObject({ incident: { notifySubscribers: false } })
    await publish(`${marker} sentinel`, [[svc.id, 'degraded_performance']])
    await waitForMail({ to: sub.email, subject: `${marker} sentinel` })
    expect(await mailsWith(sub.email, `${marker} silent`)).toEqual([])
    expect(await statusBells(sub.principalUuid, inc.id)).toEqual([])
    const admInc = await must<{ notifiedSubscriberCount: number | null }>(
      admin,
      'getStatusIncidentAdminFn',
      { id: inc.id },
      { method: 'GET' }
    )
    expect(admInc.notifiedSubscriberCount).toBeNull()
    const ui = await asPerson('admin')
    await openAdmin(ui, `/admin/status?view=open&incident=${inc.id}`)
    await expect(
      ui.getByText(
        'Subscribers were not emailed: "Email subscribers" was off when this was published. Updates appear on the status page and in-app.'
      )
    ).toBeVisible()
  }
)

test(
  'STA-S-15 component-scoped subscribers hear only about their services',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const a = await createService(admin, `${marker} A`)
    const b = await createService(admin, `${marker} B`)
    const follower = await subscriber(playwright, marker, 'follow', 'components', [a.id])
    const onlyB = await publish(`${marker} only B`, [[b.id, 'major_outage']])
    await publish(`${marker} A and B`, [
      [a.id, 'degraded_performance'],
      [b.id, 'major_outage'],
    ])
    const mail = await waitForMail({ to: follower.email, subject: `${marker} A and B` })
    expect(text(mail)).toContain(`${marker} A: Degraded performance`)
    expect(text(mail)).toContain(`${marker} B: Major outage`)
    expect(await mailsWith(follower.email, `${marker} only B`)).toEqual([])
    expect(await statusBells(follower.principalUuid, onlyB.id)).toEqual([])
  }
)

test(
  'STA-S-16 recipients see only what the page shows them',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const outsider = await subscriber(playwright, marker, 'outsider')
    const member = await subscriber(playwright, marker, 'member')
    const segment = await createSegment(marker, [member.principalUuid])
    const g = await createService(admin, `${marker} G`, { segmentIds: [segment.id] })
    const p = await createService(admin, `${marker} P`)
    await publish(`${marker} mixed`, [
      [g.id, 'major_outage'],
      [p.id, 'degraded_performance'],
    ])
    const outMail = text(await waitForMail({ to: outsider.email, subject: `${marker} mixed` }))
    expect(outMail).toContain('Minor impact')
    expect(outMail).toContain(`${marker} P: Degraded performance`)
    expect(outMail).not.toContain(`${marker} G`)
    const memMail = text(await waitForMail({ to: member.email, subject: `${marker} mixed` }))
    expect(memMail).toContain('Critical impact')
    expect(memMail).toContain(`${marker} G: Major outage`)

    const gOnly = await publish(`${marker} G only`, [[g.id, 'major_outage']])
    await waitForMail({ to: member.email, subject: `${marker} G only` })
    expect(await mailsWith(outsider.email, `${marker} G only`)).toEqual([])
    expect(await statusBells(outsider.principalUuid, gOnly.id)).toEqual([])
  }
)

test(
  'STA-S-19 STA-S-20 blocked and unsubscribed people get nothing',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Stop`)
    const blocked = await subscriber(playwright, marker, 'blocked')
    const gone = await subscriber(playwright, marker, 'gone')
    const kept = await subscriber(playwright, marker, 'kept')
    await blockPrincipal(blocked.principalUuid)
    await unsubscribeAs(gone)
    const inc = await publish(`${marker} after stop`, [[svc.id, 'major_outage']])
    await waitForMail({ to: kept.email, subject: `${marker} after stop` })
    for (const u of [blocked, gone]) {
      expect(await mailsWith(u.email, `${marker} after stop`), u.email).toEqual([])
    }
    expect(await statusBells(gone.principalUuid, inc.id)).toEqual([])
  }
)

test(
  'STA-S-21 unsubscribe from the email link',
  { tag: '@core' },
  async ({ playwright, page, marker }) => {
    const svc = await createService(admin, `${marker} Link`)
    const sub = await subscriber(playwright, marker, 'link')
    await publish(`${marker} with link`, [[svc.id, 'degraded_performance']])
    const mail = await waitForMail({ to: sub.email, subject: `${marker} with link` })
    const link = linksIn(mail).find((l) => l.includes('/unsubscribe?token='))!
    const url = new URL(link)
    await page.goto(url.pathname + url.search)
    await expect(page.getByText('Unsubscribe from status updates?')).toBeVisible()
    await expect(page.getByText('You will stop getting status page emails.')).toBeVisible()
    // The GET changed nothing.
    const [before] =
      await supportDb()`SELECT unsubscribed_at FROM status_subscriptions WHERE principal_id = ${sub.principalUuid}`
    expect(before.unsubscribed_at).toBeNull()
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Unsubscribe' }).click()
    await expect(
      page.getByText('You will not get more status page emails. You can subscribe again any time.')
    ).toBeVisible()
    const [after] =
      await supportDb()`SELECT unsubscribed_at FROM status_subscriptions WHERE principal_id = ${sub.principalUuid}`
    expect(after.unsubscribed_at).not.toBeNull()
    await page.goto(url.pathname + url.search)
    await expect(page.getByText('This link was already used')).toBeVisible()
  }
)

test(
  'STA-S-22 one-click unsubscribe',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    const svc = await createService(admin, `${marker} One click`)
    const sub = await subscriber(playwright, marker, 'oneclick')
    await publish(`${marker} one click`, [[svc.id, 'degraded_performance']])
    const mail = await waitForMail({ to: sub.email, subject: `${marker} one click` })
    const url = new URL(linksIn(mail).find((l) => l.includes('/unsubscribe?token='))!)
    const path = url.pathname + url.search
    const wrong = await request.post(path, { form: { other: 'x' } })
    expect(wrong.status()).toBe(400)
    expect(await wrong.text()).toBe('Expected List-Unsubscribe=One-Click')
    const ok = await request.post(path, { form: { 'List-Unsubscribe': 'One-Click' } })
    expect(ok.status()).toBe(200)
    expect(await ok.text()).toBe('OK')
    expect(ok.headers()['content-type']).toMatch(/text\/plain/)
    expect(ok.headers()['cache-control']).toMatch(/no-store/)
    const [row] =
      await supportDb()`SELECT unsubscribed_at FROM status_subscriptions WHERE principal_id = ${sub.principalUuid}`
    expect(row.unsubscribed_at).not.toBeNull()
    const unknown = await request.post('/unsubscribe?token=00000000-0000-4000-8000-000000000000', {
      form: { 'List-Unsubscribe': 'One-Click' },
    })
    expect(unknown.status()).toBe(200)
  }
)

test(
  'STA-S-23 nothing is emailed for an incident or window created already over',
  {
    tag: '@nightly',
  },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Over`)
    const sub = await subscriber(playwright, marker, 'over')
    await createIncident(admin, {
      title: `${marker} already resolved`,
      status: 'resolved',
      services: [[svc.id, 'major_outage']],
      notifySubscribers: true,
    })
    await publish(`${marker} sentinel`, [[svc.id, 'degraded_performance']])
    await waitForMail({ to: sub.email, subject: `${marker} sentinel` })
    expect(await mailsWith(sub.email, `${marker} already resolved`)).toEqual([])
  }
)

test(
  'STA-S-24 backfilled incidents never notify, even after the notify sweep',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const svc = await createService(admin, `${marker} Past`)
    const sub = await subscriber(playwright, marker, 'past')
    const past = await createIncident(admin, {
      title: `${marker} backfilled`,
      status: 'resolved',
      services: [[svc.id, 'major_outage']],
      backfill: {
        startedAt: new Date(Date.now() - 86_400_000),
        resolvedAt: new Date(Date.now() - 82_800_000),
      },
    })
    await supportDb()`UPDATE status_incidents SET created_at = now() - interval '10 minutes'
    WHERE id = ${(await incidentRow(past.id)).id}`
    await runSweep(request, 'status-notify')
    await publish(`${marker} sentinel`, [[svc.id, 'degraded_performance']])
    await waitForMail({ to: sub.email, subject: `${marker} sentinel` })
    expect(await mailsWith(sub.email, `${marker} backfilled`)).toEqual([])
    expect(await statusBells(sub.principalUuid, past.id)).toEqual([])
    expect(await domainEvents(past.id)).toEqual([])
    expect((await incidentRow(past.id)).notified_at).toBeNull()
  }
)

test(
  'STA-S-26 the notify reconcile announces an unclaimed row once',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    const svc = await createService(admin, `${marker} Missed`)
    const sub = await subscriber(playwright, marker, 'missed')
    const inc = await createIncident(admin, {
      title: `${marker} missed`,
      services: [[svc.id, 'degraded_performance']],
      notifySubscribers: false,
    })
    // As an older version would have left it: unclaimed, asking for the email, 10 minutes old.
    const dbId = (await incidentRow(inc.id)).id
    await supportDb()`DELETE FROM events WHERE entity_id = ${inc.id}`
    await supportDb()`UPDATE status_incidents
    SET notified_at = NULL, notify_subscribers = true, created_at = now() - interval '10 minutes'
    WHERE id = ${dbId}`
    await runSweep(request, 'status-notify')
    expect((await incidentRow(inc.id)).notified_at).not.toBeNull()
    await waitForMail({ to: sub.email, subject: `${marker} missed` })
    await runSweep(request, 'status-notify')
    await waitForEventHandled(inc.id, { type: 'status.incident_created' })
    expect(
      (await domainEvents(inc.id)).filter((e) => e.type === 'status.incident_created')
    ).toHaveLength(1)
    await publish(`${marker} sentinel`, [[svc.id, 'degraded_performance']])
    await waitForMail({ to: sub.email, subject: `${marker} sentinel` })
    expect(await mailsWith(sub.email, `${marker} missed`)).toHaveLength(1)
  }
)

test(
  'STA-S-29 the editor\'s "emailed ~N" count follows the pool',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Count`)
    await subscriber(playwright, marker, 'c1', 'components', [svc.id])
    await subscriber(playwright, marker, 'c2', 'components', [svc.id])
    const inc = await publish(`${marker} counted`, [[svc.id, 'degraded_performance']])
    const read = async () =>
      (
        await must<{ notifiedSubscriberCount: number | null }>(
          admin,
          'getStatusIncidentAdminFn',
          { id: inc.id },
          { method: 'GET' }
        )
      ).notifiedSubscriberCount
    const first = await read()
    expect(first).toBeGreaterThanOrEqual(2)
    await subscriber(playwright, marker, 'c3', 'components', [svc.id])
    expect(await read()).toBeGreaterThanOrEqual((first ?? 0) + 1)
  }
)

test(
  'STA-S-30 an incident cannot be pinned to the "maintenance" impact',
  {
    tag: '@nightly',
  },
  async ({ marker }) => {
    const svc = await createService(admin, `${marker} Pin`)
    const res = await callServerFn(admin, 'createStatusIncidentFn', {
      kind: 'incident',
      title: marker,
      status: 'investigating',
      body: 'x',
      impact: 'maintenance',
      impactOverride: true,
      notifySubscribers: false,
      affectedComponents: [{ componentId: svc.id, componentStatus: 'major_outage' }],
    })
    expect(res.ok).toBe(false)
  }
)
