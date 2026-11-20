/**
 * Status webhooks, delivered to the webhook sink.
 *
 * Journeys: STA-X-12, STA-X-13, STA-X-14, STA-X-15.
 *
 * A status webhook receives every test's status events, so each test reads
 * only deliveries that name its own incident or service id. "No delivery" is
 * proved against a later delivery on the same hook (the dispatch is in order
 * per hook only loosely, so the sentinel's own event is waited for first).
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { waitForEventHandled } from '../../support/bells'
import { runSweep } from '../../support/sweeps'
import {
  bodyOf,
  deliveriesOf,
  expectSigned,
  hooksApi,
  subscribe,
  unsubscribe,
  type Hook,
} from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import { supportEnv } from '../../support/env'
import {
  backdateWindow,
  createIncident,
  createService,
  deleteMadeIncidents,
  must,
  postUpdate,
  scheduleWindow,
  setServiceStatus,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

const STATUS_EVENTS = [
  'status.incident_created',
  'status.incident_updated',
  'status.maintenance_scheduled',
  'status.maintenance_started',
  'status.maintenance_completed',
  'status.component_changed',
]

let admin: APIRequestContext
let rest: APIRequestContext
let hook: Hook | undefined

test.beforeEach(async ({ playwright, people, marker }) => {
  admin = await personApi(playwright, 'admin')
  rest = await hooksApi(playwright, supportEnv().baseUrl, people, marker)
  hook = await subscribe(rest, marker, STATUS_EVENTS)
})
test.afterEach(async () => {
  await unsubscribe(rest, hook)
  await deleteMadeIncidents(admin)
  await admin.dispose()
  await rest.dispose()
})

const typesFor = async (channel: string, id: string) =>
  (await sink.deliveries(channel))
    .filter((d) => d.body.includes(id))
    .map((d) => d.headers['x-quackback-event'])

test('STA-X-12 status.incident_created', { tag: '@core' }, async ({ marker }) => {
  const svc = await createService(admin, `${marker} Hooked`)
  const inc = await createIncident(admin, {
    title: `${marker} hooked`,
    services: [[svc.id, 'major_outage']],
  })
  const [d] = await deliveriesOf(marker, 'status.incident_created', inc.id)
  expectSigned(d, hook!.secret)
  const body = bodyOf<{ incident: Record<string, unknown> }>(d)
  expect(body.type).toBe('status.incident_created')
  expect(body.data.incident).toMatchObject({
    id: inc.id,
    kind: 'incident',
    title: `${marker} hooked`,
    status: 'investigating',
    impact: 'critical',
    componentIds: [svc.id],
    notifySubscribers: false,
    scheduledStartAt: null,
    scheduledEndAt: null,
  })
  // A backfill sends nothing; the next publish bounds the wait.
  const past = await createIncident(admin, {
    title: `${marker} past`,
    status: 'resolved',
    services: [[svc.id, 'major_outage']],
    backfill: {
      startedAt: new Date(Date.now() - 86_400_000),
      resolvedAt: new Date(Date.now() - 3_600_000),
    },
  })
  const sentinel = await createIncident(admin, {
    title: `${marker} sentinel`,
    services: [[svc.id, 'degraded_performance']],
  })
  await deliveriesOf(marker, 'status.incident_created', sentinel.id)
  expect(await typesFor(marker, past.id)).toEqual([])
})

test(
  'STA-X-13 status.incident_updated per posted update only',
  { tag: '@core' },
  async ({ marker }) => {
    const svc = await createService(admin, `${marker} Updates`)
    const inc = await createIncident(admin, {
      title: `${marker} updates`,
      services: [[svc.id, 'major_outage']],
    })
    await postUpdate(admin, inc.id, 'identified', 'found')
    await postUpdate(admin, inc.id, 'resolved', 'fixed')
    await postUpdate(admin, inc.id, 'investigating', 'back')
    const ds = await deliveriesOf(marker, 'status.incident_updated', inc.id, { count: 3 })
    expect(ds.map((d) => bodyOf<{ status: string }>(d).data.status).sort()).toEqual([
      'identified',
      'investigating',
      'resolved',
    ])
    for (const d of ds) {
      const data = bodyOf<Record<string, unknown>>(d).data
      expect(data).toMatchObject({ incidentId: inc.id, kind: 'incident' })
      expect(data).toHaveProperty('body')
      expect(data).not.toHaveProperty('title')
    }
    // A title edit sends nothing.
    await must(admin, 'updateStatusIncidentFn', { id: inc.id, title: `${marker} renamed` })
    await postUpdate(admin, inc.id, 'identified', 'sentinel')
    await deliveriesOf(marker, 'status.incident_updated', inc.id, { count: 4 })
    expect(
      (await typesFor(marker, inc.id)).filter((t) => t === 'status.incident_updated')
    ).toHaveLength(4)
  }
)

test(
  'STA-X-14 maintenance scheduled, started and completed, once per transition',
  { tag: '@core' },
  async ({ request, marker }) => {
    const svc = await createService(admin, `${marker} Window`)
    // By the scheduler.
    const auto = await scheduleWindow(admin, {
      title: `${marker} auto`,
      services: [[svc.id, 'under_maintenance']],
    })
    await backdateWindow(auto.id, { start: new Date(Date.now() - 1_000) })
    await runSweep(request, 'status-maintenance')
    await backdateWindow(auto.id, { end: new Date(Date.now() - 1_000) })
    await runSweep(request, 'status-maintenance')
    // By hand.
    const manual = await scheduleWindow(admin, {
      title: `${marker} manual`,
      services: [[svc.id, 'under_maintenance']],
    })
    await postUpdate(admin, manual.id, 'in_progress', 'going')
    await postUpdate(admin, manual.id, 'completed', 'done')

    for (const w of [auto, manual]) {
      await deliveriesOf(marker, 'status.maintenance_completed', w.id)
      const types = await typesFor(marker, w.id)
      expect(types.filter((t) => t === 'status.maintenance_scheduled')).toHaveLength(1)
      expect(types.filter((t) => t === 'status.maintenance_started')).toHaveLength(1)
      expect(types.filter((t) => t === 'status.maintenance_completed')).toHaveLength(1)
      const [started] = await deliveriesOf(marker, 'status.maintenance_started', w.id)
      expect(bodyOf(started).data).toEqual({
        incidentId: w.id,
        title: w.title,
        componentIds: [svc.id],
      })
    }

    // Created already running: scheduled, then started.
    const running = await createIncident(admin, {
      kind: 'maintenance',
      status: 'in_progress',
      title: `${marker} running`,
      services: [[svc.id, 'under_maintenance']],
      scheduledStartAt: new Date(Date.now() - 60_000),
      scheduledEndAt: new Date(Date.now() + 3_600_000),
    })
    await deliveriesOf(marker, 'status.maintenance_started', running.id)
    await deliveriesOf(marker, 'status.maintenance_scheduled', running.id)
    await waitForEventHandled(running.id, { type: 'status.maintenance_started' })
  }
)

test(
  'STA-X-15 status.component_changed only for hand and API changes',
  { tag: '@core' },
  async ({ marker }) => {
    const svc = await createService(admin, `${marker} Changed`)
    await setServiceStatus(admin, svc.id, 'degraded_performance')
    const patched = await rest.patch(`/api/v1/status/services/${svc.id}`, {
      data: { status: 'partial_outage' },
    })
    expect(patched.status()).toBe(200)
    const ds = await deliveriesOf(marker, 'status.component_changed', svc.id, { count: 2 })
    const datas = ds.map(
      (d) => bodyOf<{ source: string; previousStatus: string; status: string }>(d).data
    )
    expect(datas.map((x) => `${x.source}:${x.previousStatus}->${x.status}`).sort()).toEqual([
      'api:degraded_performance->partial_outage',
      'manual:operational->degraded_performance',
    ])
    // An incident moving the service sends only the incident's own event.
    const inc = await createIncident(admin, { title: marker, services: [[svc.id, 'major_outage']] })
    await deliveriesOf(marker, 'status.incident_created', inc.id)
    await waitForEventHandled(inc.id, { type: 'status.incident_created' })
    await setServiceStatus(admin, svc.id, 'operational')
    await deliveriesOf(marker, 'status.component_changed', svc.id, { count: 3 })
    expect(
      (await typesFor(marker, svc.id)).filter((t) => t === 'status.component_changed')
    ).toHaveLength(3)
  }
)
