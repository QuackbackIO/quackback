/**
 * The status page over the public REST API (/api/v1/status): services,
 * incidents, maintenance windows, their updates and announcements, and the
 * scopes and permissions that guard the writes.
 *
 * Journeys: API-R-122, API-R-123, API-R-125, API-R-126, API-R-127,
 * API-R-128, API-R-129, API-R-130, API-R-131, API-R-132, API-R-133,
 * API-R-134, API-R-135, API-R-136, API-R-137.
 *
 * Not here: API-R-124 (the module switch) is an owner question, as is the
 * API-R-123 claim that a key without status permission or scope may read;
 * API-R-126's plan cap (402) needs a tier-limits fixture; API-R-138 (DELETE,
 * after #908) is not routed in this build.
 *
 * Every test works on services it creates, and resolves or completes every
 * incident and window it opens (in `finally`), so the public page goes back
 * to how other tests expect it.
 */
import { generateId } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { apiFor, createKey, expectJson, newTeammate, type Wire } from '../../support/api-client'
import { supportDb } from '../../support/db'
import { mailTo, waitForMail } from '../../support/mailpit'
import { bellsFor, waitForEventHandled } from '../../support/bells'
import {
  adminApi,
  eventsMentioning,
  jobRowsLike,
  missingScope,
  rawJson,
  roleKeyOf,
  seedSegment,
  seedStatusSubscriber,
  serviceHistory,
  uuid,
} from '../../product/api-rest-content'

test.describe.configure({ timeout: 60_000 })

const SERVICE_KEYS = [
  'description',
  'groupId',
  'id',
  'name',
  'position',
  'segmentIds',
  'showUptime',
  'status',
]
const INCIDENT_KEYS = [
  'affectedComponents',
  'autoComplete',
  'autoStart',
  'backfilled',
  'createdAt',
  'createdBy',
  'id',
  'impact',
  'impactOverride',
  'kind',
  'notifiedAt',
  'resolvedAt',
  'scheduledEndAt',
  'scheduledStartAt',
  'startedAt',
  'status',
  'title',
  'updatedAt',
  'updates',
]

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

async function createService(
  api: APIRequestContext,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<Wire> {
  const body = await expectJson(
    await api.post('/api/v1/status/services', { data: { name, ...extra } }),
    201
  )
  return body.data
}

async function openIncident(
  api: APIRequestContext,
  serviceId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<Wire> {
  const body = await expectJson(
    await api.post('/api/v1/status/incidents', {
      data: {
        kind: 'incident',
        title,
        status: 'investigating',
        affectedComponents: [{ componentId: serviceId, componentStatus: 'partial_outage' }],
        body: `${title}: looking into it`,
        ...extra,
      },
    }),
    201
  )
  return body.data
}

async function postUpdate(
  api: APIRequestContext,
  incidentId: string,
  data: Record<string, unknown>,
  status = 201
): Promise<Wire> {
  return expectJson(
    await api.post(`/api/v1/status/incidents/${incidentId}/updates`, { data }),
    status
  )
}

/** Close whatever this test left open: resolve incidents, complete windows. */
async function closeAll(api: APIRequestContext, incidents: Array<{ id: string; kind: string }>) {
  for (const incident of incidents) {
    await api.post(`/api/v1/status/incidents/${incident.id}/updates`, {
      data: { status: incident.kind === 'incident' ? 'resolved' : 'completed', body: 'Done' },
    })
  }
}

async function serviceStatus(api: APIRequestContext, serviceId: string): Promise<string> {
  const body = await expectJson(await api.get(`/api/v1/status/services/${serviceId}`), 200)
  return body.data.status
}

test.describe('REST status: reads', () => {
  test(
    'API-R-122 the summary has the top-level status, every service and the active incidents',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const segment = await seedSegment(marker)
      const service = await createService(api, `${marker} api`, {
        description: 'The public API',
        segmentIds: [segment],
      })
      const opened: Wire[] = []
      try {
        const incident = await openIncident(api, service.id, `${marker} slow`)
        opened.push(incident)
        const body = await expectJson(await api.get('/api/v1/status/summary'), 200)
        expect(Object.keys(body.data).sort()).toEqual(['activeIncidents', 'components', 'status'])
        expect(typeof body.data.status).toBe('string')
        // A team key sees the segment-restricted service and its incident.
        expect(body.data.components.find((c: Wire) => c.id === service.id)).toEqual({
          id: service.id,
          name: `${marker} api`,
          description: 'The public API',
          status: 'partial_outage',
          showUptime: true,
        })
        const active = body.data.activeIncidents.find((i: Wire) => i.id === incident.id)
        expect(Object.keys(active).sort()).toEqual(
          [
            'affectedComponents',
            'id',
            'impact',
            'kind',
            'resolvedAt',
            'scheduledEndAt',
            'scheduledStartAt',
            'startedAt',
            'status',
            'title',
            'updates',
          ].sort()
        )
        expect(active).toMatchObject({
          kind: 'incident',
          title: `${marker} slow`,
          status: 'investigating',
          impact: 'major',
          resolvedAt: null,
          affectedComponents: [
            { id: service.id, name: `${marker} api`, componentStatus: 'partial_outage' },
          ],
        })
        expect(active.updates).toEqual([
          {
            id: expect.any(String),
            status: 'investigating',
            body: `${marker} slow: looking into it`,
            createdAt: expect.any(String),
          },
        ])

        // Resolved, it leaves the active list.
        await closeAll(api, opened.splice(0))
        const after = await expectJson(await api.get('/api/v1/status/summary'), 200)
        expect(after.data.activeIncidents.map((i: Wire) => i.id)).not.toContain(incident.id)
        expect(after.data.components.find((c: Wire) => c.id === service.id).status).toBe(
          'operational'
        )
      } finally {
        await closeAll(api, opened)
        await api.dispose()
      }
    }
  )

  test(
    'API-R-123 a status key reads services with segments and incidents with their audit fields',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      // Whether keys without status permission or scope may read is an owner
      // question; this proves what a properly privileged key gets.
      const { api, principalId } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:feedback', 'write:feedback'],
      })
      const segment = await seedSegment(marker)
      const service = await createService(api, `${marker} svc`, { segmentIds: [segment] })
      const opened: Wire[] = []
      try {
        const incident = await openIncident(api, service.id, `${marker} down`)
        opened.push(incident)
        const services = await expectJson(await api.get('/api/v1/status/services'), 200)
        expect(services.data.find((s: Wire) => s.id === service.id).segmentIds).toEqual([segment])
        const list = await expectJson(await api.get('/api/v1/status/incidents?limit=100'), 200)
        const listed = list.data.find((i: Wire) => i.id === incident.id)
        expect(listed.createdBy).toBe(principalId)
        expect(listed.notifiedAt).not.toBeNull()
        const one = await expectJson(await api.get(`/api/v1/status/incidents/${incident.id}`), 200)
        expect(one.data.updates[0].createdBy).toBe(principalId)
        expect(one.data.affectedComponents[0].segmentIds).toEqual([segment])
        const summary = await expectJson(await api.get('/api/v1/status/summary'), 200)
        expect(summary.data.activeIncidents.map((i: Wire) => i.id)).toContain(incident.id)
      } finally {
        await closeAll(api, opened)
        await api.dispose()
      }
    }
  )

  test(
    'API-R-125 services and the legacy components path answer the same flat list',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const services = await expectJson(await api.get('/api/v1/status/services'), 200)
      const components = await expectJson(await api.get('/api/v1/status/components'), 200)
      // Other tests change their own services meanwhile: compare this one.
      expect(Object.keys(components).sort()).toEqual(['data'])
      expect(Object.keys(services).sort()).toEqual(['data'])
      const mine = services.data.find((s: Wire) => s.id === service.id)
      expect(components.data.find((s: Wire) => s.id === service.id)).toEqual(mine)
      expect(Object.keys(mine).sort()).toEqual(SERVICE_KEYS)
      expect(mine).toMatchObject({ name: `${marker} svc`, groupId: null, status: 'operational' })
      await api.dispose()
    }
  )

  test(
    'API-R-127 get one service; a deleted one is not found',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`, { description: 'D' })
      const got = await expectJson(await api.get(`/api/v1/status/services/${service.id}`), 200)
      expect(got.data).toEqual(service)
      expect(Object.keys(got.data).sort()).toEqual(SERVICE_KEYS)

      await supportDb()`UPDATE status_components SET deleted_at = NOW() WHERE id = ${uuid(service.id)}`
      const gone = await expectJson(await api.get(`/api/v1/status/services/${service.id}`), 404)
      expect(gone.error.code).toBe('NOT_FOUND')
      const bad = await expectJson(await api.get('/api/v1/status/services/nope'), 400)
      expect(bad.error.code).toBe('VALIDATION_ERROR')
      await api.dispose()
    }
  )

  test(
    'API-R-127 the services path names a service, not a component, in its errors',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const bad = await expectJson(await api.get('/api/v1/status/services/nope'), 400)
      expect(bad.error.message).toMatch(/service/i)
      const missing = await expectJson(
        await api.get(`/api/v1/status/services/${generateId('status_component')}`),
        404
      )
      expect(missing.error.message).toMatch(/service/i)
      await api.dispose()
    }
  )

  test(
    'API-R-137 incidents filter by kind and state, page by id, and get one with its timeline',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const opened: Wire[] = []
      try {
        const resolved = await openIncident(api, service.id, `${marker} old`)
        await postUpdate(api, resolved.id, { status: 'resolved', body: 'Fixed' })
        const window = (
          await expectJson(
            await api.post('/api/v1/status/incidents', {
              data: {
                kind: 'maintenance',
                title: `${marker} window`,
                status: 'scheduled',
                scheduledStartAt: inMinutes(600),
                scheduledEndAt: inMinutes(660),
                affectedComponents: [
                  { componentId: service.id, componentStatus: 'under_maintenance' },
                ],
                body: 'Planned',
              },
            }),
            201
          )
        ).data
        opened.push(window)
        const ids = async (query: string) =>
          (
            await expectJson(await api.get(`/api/v1/status/incidents?limit=100&${query}`), 200)
          ).data.map((i: Wire) => i.id)

        const activeMaint = await ids('kind=maintenance&state=active')
        expect(activeMaint).toContain(window.id)
        expect(activeMaint).not.toContain(resolved.id)
        const resolvedList = await ids('state=resolved')
        expect(resolvedList).toContain(resolved.id)
        expect(resolvedList).not.toContain(window.id)
        // Unknown values fall back to everything.
        const bogus = await ids('kind=bogus&state=bogus')
        expect(bogus).toEqual(expect.arrayContaining([window.id, resolved.id]))
        // Newest first.
        expect(bogus.indexOf(window.id)).toBeLessThan(bogus.indexOf(resolved.id))

        const page1 = await expectJson(await api.get('/api/v1/status/incidents?limit=1'), 200)
        expect(page1.data).toHaveLength(1)
        expect(page1.meta.pagination.cursor).toBe(page1.data[0].id)
        const page2 = await expectJson(
          await api.get(`/api/v1/status/incidents?limit=1&cursor=${page1.meta.pagination.cursor}`),
          200
        )
        expect(page2.data[0].id).not.toBe(page1.data[0].id)

        const one = await expectJson(await api.get(`/api/v1/status/incidents/${resolved.id}`), 200)
        expect(Object.keys(one.data).sort()).toEqual(INCIDENT_KEYS)
        expect(one.data.updates.map((u: Wire) => u.status)).toEqual(['investigating', 'resolved'])
        const missing = await expectJson(
          await api.get(`/api/v1/status/incidents/${generateId('status_incident')}`),
          404
        )
        expect(missing.error).toMatchObject({
          code: 'NOT_FOUND',
          message: 'Status incident not found',
        })
      } finally {
        await closeAll(api, opened)
        await api.dispose()
      }
    }
  )
})

test.describe('REST status: services', () => {
  test(
    'API-R-126 create a service with the admin shape; bad bodies and ids are refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const segment = await seedSegment(marker)
      const res = await api.post('/api/v1/status/services', {
        data: {
          name: `${marker} svc`,
          description: 'Desc',
          status: 'operational',
          showUptime: true,
          segmentIds: [segment],
        },
      })
      const created = await expectJson(res, 201)
      expect(Object.keys(created.data).sort()).toEqual(SERVICE_KEYS)
      expect(created.data).toMatchObject({
        name: `${marker} svc`,
        description: 'Desc',
        status: 'operational',
        showUptime: true,
        segmentIds: [segment],
        groupId: null,
      })
      const [row] =
        await supportDb()`SELECT name FROM status_components WHERE id = ${uuid(created.data.id)}`
      expect(row.name).toBe(`${marker} svc`)

      const noName = await expectJson(
        await api.post('/api/v1/status/services', { data: { description: 'x' } }),
        400
      )
      expect(noName.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid request body' })
      expect(noName.error.details.errors.name).toHaveLength(1)
      const blankName = await expectJson(
        await api.post('/api/v1/status/services', { data: { name: '' } }),
        400
      )
      expect(blankName.error.details.errors.name).toEqual(['Name is required'])
      for (const [data, message] of [
        [{ name: `${marker} bad group`, groupId: 'x' }, 'Invalid groupId format'],
        [{ name: `${marker} bad segment`, segmentIds: ['x'] }, 'Invalid segmentIds format'],
      ] as const) {
        const bad = await expectJson(await api.post('/api/v1/status/services', { data }), 400)
        expect(bad.error).toMatchObject({ code: 'VALIDATION_ERROR', message })
      }
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM status_components WHERE name LIKE ${`${marker}%`}`
      expect(n).toBe(1)
      await api.dispose()
    }
  )

  test(
    'API-R-128 setting a live status writes history and one event per change, and the summary follows',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} monitored`)
      const setStatus = (status: string) =>
        api.patch(`/api/v1/status/services/${service.id}`, { data: { status } })
      try {
        const down = await expectJson(await setStatus('major_outage'), 200)
        expect(down.data.status).toBe('major_outage')
        const changed = await eventsMentioning(service.id, 'status.component_changed')
        expect(changed).toHaveLength(1)
        expect(changed[0].actor_type).toBe('service')
        expect(changed[0].payload).toMatchObject({
          componentId: service.id,
          componentName: `${marker} monitored`,
          previousStatus: 'operational',
          status: 'major_outage',
          source: 'api',
        })
        const summary = await expectJson(await api.get('/api/v1/status/summary'), 200)
        expect(summary.data.components.find((c: Wire) => c.id === service.id).status).toBe(
          'major_outage'
        )

        // The same status again changes nothing.
        expect((await expectJson(await setStatus('major_outage'), 200)).data.status).toBe(
          'major_outage'
        )
        expect(await eventsMentioning(service.id, 'status.component_changed')).toHaveLength(1)

        const up = await expectJson(await setStatus('operational'), 200)
        expect(up.data.status).toBe('operational')
        expect(await eventsMentioning(service.id, 'status.component_changed')).toHaveLength(2)
        expect((await serviceHistory(service.id)).filter((h) => h.source === 'api')).toEqual([
          { status: 'major_outage', source: 'api' },
          { status: 'operational', source: 'api' },
        ])
      } finally {
        await setStatus('operational')
        await api.dispose()
      }
    }
  )

  test(
    'API-R-129 update service details: empty body refused, a rename emits no status event, ungroup, missing id',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const groupId = generateId('status_group')
      await supportDb()`INSERT INTO status_component_groups (id, name)
        VALUES (${uuid(groupId)}, ${`${marker} group`})`
      const service = await createService(api, `${marker} svc`, { groupId })
      expect(service.groupId).toBe(groupId)
      const patch = (data: Record<string, unknown>, id = service.id) =>
        api.patch(`/api/v1/status/services/${id}`, { data })

      const empty = await expectJson(await patch({}), 400)
      expect(empty.error).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'At least one field is required',
      })
      const renamed = await expectJson(await patch({ name: `${marker} renamed` }), 200)
      expect(renamed.data.name).toBe(`${marker} renamed`)
      expect(await eventsMentioning(service.id, 'status.component_changed')).toEqual([])
      const ungrouped = await expectJson(await patch({ groupId: null }), 200)
      expect(ungrouped.data.groupId).toBeNull()
      // Status and metadata together apply both.
      const both = await expectJson(
        await patch({ description: 'Both', status: 'degraded_performance' }),
        200
      )
      expect(both.data).toMatchObject({ description: 'Both', status: 'degraded_performance' })
      await patch({ status: 'operational' })

      const missing = await expectJson(
        await patch({ name: 'x' }, generateId('status_component')),
        404
      )
      expect(missing.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Status service not found',
      })
      await api.dispose()
    }
  )
})

test.describe('REST status: incidents', () => {
  test(
    'API-R-130 creating an incident moves the service, writes one event and emails followers; notifySubscribers:false stays quiet',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api, principalId } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const quiet = await createService(api, `${marker} quiet svc`)
      const subscriber = await seedStatusSubscriber(marker, [service.id, quiet.id])
      const opened: Wire[] = []
      try {
        const title = `${marker} outage`
        const incident = await openIncident(api, service.id, title)
        opened.push(incident)
        expect(Object.keys(incident).sort()).toEqual(INCIDENT_KEYS)
        expect(incident).toMatchObject({
          kind: 'incident',
          status: 'investigating',
          impact: 'major',
          backfilled: false,
          createdBy: principalId,
          resolvedAt: null,
        })
        expect(incident.notifiedAt).not.toBeNull()
        expect(await serviceStatus(api, service.id)).toBe('partial_outage')
        expect(await eventsMentioning(incident.id, 'status.incident_created')).toHaveLength(1)
        const mail = await waitForMail({ to: subscriber.email, subject: `Incident: ${title}` })
        expect(mail.Subject).toBe(`Incident: ${title}`)

        const quietTitle = `${marker} silent`
        const silent = await openIncident(api, quiet.id, quietTitle, { notifySubscribers: false })
        opened.push(silent)
        expect(await eventsMentioning(silent.id, 'status.incident_created')).toHaveLength(1)
        await waitForEventHandled(silent.id, { type: 'status.incident_created' })
        expect((await mailTo(subscriber.email)).map((m) => m.Subject)).not.toContain(
          `Incident: ${quietTitle}`
        )
        expect((await bellsFor(subscriber.principalId, silent.id)).length).toBe(0)
      } finally {
        await closeAll(api, opened)
        await api.dispose()
      }
    }
  )

  test(
    'API-R-131 a scheduled window announces and queues its jobs; an in-progress one holds its services at once',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const subscriber = await seedStatusSubscriber(marker, [service.id])
      const opened: Wire[] = []
      try {
        const title = `${marker} upgrade`
        const scheduled = (
          await expectJson(
            await api.post('/api/v1/status/incidents', {
              data: {
                kind: 'maintenance',
                title,
                status: 'scheduled',
                scheduledStartAt: inMinutes(60),
                scheduledEndAt: inMinutes(120),
                affectedComponents: [
                  { componentId: service.id, componentStatus: 'under_maintenance' },
                ],
                body: 'Planned upgrade',
              },
            }),
            201
          )
        ).data
        opened.push(scheduled)
        expect(scheduled).toMatchObject({
          kind: 'maintenance',
          status: 'scheduled',
          impact: 'maintenance',
          autoStart: true,
          autoComplete: true,
        })
        expect(await eventsMentioning(scheduled.id, 'status.maintenance_scheduled')).toHaveLength(1)
        await waitForMail({ to: subscriber.email, subject: `Scheduled maintenance: ${title}` })
        const jobs = (await jobRowsLike('status-maintenance-')).filter((j) =>
          j.dedupe_key.includes(scheduled.id)
        )
        expect(jobs.map((j) => j.dedupe_key.split('--')[0]).sort()).toEqual([
          'status-maintenance-complete',
          'status-maintenance-start',
        ])
        expect(await serviceStatus(api, service.id)).toBe('operational')

        const now = (
          await expectJson(
            await api.post('/api/v1/status/incidents', {
              data: {
                kind: 'maintenance',
                title: `${marker} now`,
                status: 'in_progress',
                scheduledStartAt: inMinutes(-1),
                scheduledEndAt: inMinutes(60),
                affectedComponents: [
                  { componentId: service.id, componentStatus: 'under_maintenance' },
                ],
                body: 'Working on it',
              },
            }),
            201
          )
        ).data
        opened.push(now)
        expect(now.status).toBe('in_progress')
        expect(await serviceStatus(api, service.id)).toBe('under_maintenance')
        expect(await eventsMentioning(now.id, 'status.maintenance_scheduled')).toHaveLength(1)
        expect(await eventsMentioning(now.id, 'status.maintenance_started')).toHaveLength(1)
      } finally {
        await closeAll(api, opened)
        await api.dispose()
      }
    }
  )

  test(
    'API-R-134 updates append to the timeline: resolve restores, reopen re-holds, skipRestore leaves services alone',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const subscriber = await seedStatusSubscriber(marker, [service.id])
      const opened: Wire[] = []
      try {
        const title = `${marker} flapping`
        const incident = await openIncident(api, service.id, title)
        opened.push(incident)

        const monitoring = await postUpdate(api, incident.id, {
          status: 'monitoring',
          body: 'Watching',
        })
        expect(monitoring.data.status).toBe('monitoring')
        expect(monitoring.data.updates.map((u: Wire) => [u.status, u.body])).toEqual([
          ['investigating', `${title}: looking into it`],
          ['monitoring', 'Watching'],
        ])

        const resolved = await postUpdate(api, incident.id, { status: 'resolved', body: 'Fixed' })
        expect(resolved.data.resolvedAt).not.toBeNull()
        expect(await serviceStatus(api, service.id)).toBe('operational')

        const reopened = await postUpdate(api, incident.id, {
          status: 'investigating',
          body: 'Back again',
        })
        expect(reopened.data.resolvedAt).toBeNull()
        expect(await serviceStatus(api, service.id)).toBe('partial_outage')

        const kept = await postUpdate(api, incident.id, {
          status: 'resolved',
          body: 'Resolved, service left as is',
          skipRestore: true,
        })
        expect(kept.data.resolvedAt).not.toBeNull()
        expect(await serviceStatus(api, service.id)).toBe('partial_outage')
        expect(kept.data.updates).toHaveLength(5)

        const updated = await eventsMentioning(incident.id, 'status.incident_updated')
        expect(
          updated.map((e) => (e.payload as Wire).incident?.status ?? (e.payload as Wire).status)
        ).toEqual(['monitoring', 'resolved', 'investigating', 'resolved'])
        // Updates send no email: only the incident's own announcement arrived.
        await waitForMail({ to: subscriber.email, subject: `Incident: ${title}` })
        await waitForEventHandled(incident.id, { type: 'status.incident_updated' })
        expect(
          (await mailTo(subscriber.email)).filter((m) => m.Subject.includes(marker))
        ).toHaveLength(1)

        // A scheduled window moved to in_progress starts.
        const window = (
          await expectJson(
            await api.post('/api/v1/status/incidents', {
              data: {
                kind: 'maintenance',
                title: `${marker} window`,
                status: 'scheduled',
                scheduledStartAt: inMinutes(60),
                scheduledEndAt: inMinutes(120),
                affectedComponents: [
                  { componentId: service.id, componentStatus: 'under_maintenance' },
                ],
                body: 'Planned',
                notifySubscribers: false,
              },
            }),
            201
          )
        ).data
        opened.push(window)
        const started = await postUpdate(api, window.id, {
          status: 'in_progress',
          body: 'Starting',
        })
        expect(started.data.status).toBe('in_progress')
        expect(await eventsMentioning(window.id, 'status.maintenance_started')).toHaveLength(1)
      } finally {
        await closeAll(api, opened)
        await api.patch(`/api/v1/status/services/${service.id}`, {
          data: { status: 'operational' },
        })
        await api.dispose()
      }
    }
  )

  test(
    'API-R-132 incident create validation refuses bad kinds, ids, windows and backfills; nothing is written',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const deleted = await createService(api, `${marker} deleted`)
      await supportDb()`UPDATE status_components SET deleted_at = NOW() WHERE id = ${uuid(deleted.id)}`
      const base = {
        kind: 'incident',
        title: `${marker} refused`,
        status: 'investigating',
        affectedComponents: [{ componentId: service.id, componentStatus: 'partial_outage' }],
        body: 'x',
      }
      const refuse = async (data: Record<string, unknown>) =>
        expectJson(await api.post('/api/v1/status/incidents', { data: { ...base, ...data } }), 400)

      expect((await refuse({ status: 'scheduled' })).error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message:
          '"scheduled" is not an incident status. Use one of: investigating, identified, monitoring, resolved.',
      })
      const empty = await refuse({ affectedComponents: [] })
      expect(empty.error.message).toBe('Invalid request body')
      expect(empty.error.details.errors.affectedComponents).toEqual([
        'At least one affected component is required',
      ])
      expect(
        (
          await refuse({
            affectedComponents: [{ componentId: deleted.id, componentStatus: 'major_outage' }],
          })
        ).error.message
      ).toBe('An affected service has been deleted. Choose the services again.')
      expect(
        (
          await refuse({
            affectedComponents: [{ componentId: 'x', componentStatus: 'major_outage' }],
          })
        ).error.message
      ).toBe('Invalid affectedComponents[].componentId format')
      expect(
        (
          await refuse({
            kind: 'maintenance',
            status: 'scheduled',
            scheduledStartAt: inMinutes(120),
            scheduledEndAt: inMinutes(60),
          })
        ).error.message
      ).toBe('The scheduled end must be after the scheduled start')
      expect(
        (
          await refuse({
            status: 'resolved',
            backfill: {
              startedAt: '2024-01-02T00:00:00.000Z',
              resolvedAt: '2024-01-01T00:00:00.000Z',
            },
          })
        ).error.message
      ).toBe('A past incident must be resolved after it started')

      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM status_incidents WHERE title LIKE ${`${marker}%`}`
      expect(n).toBe(0)
      expect(await serviceStatus(api, service.id)).toBe('operational')
      await api.dispose()
    }
  )

  test(
    'API-R-132 a service id that never existed is reported as unknown, not as deleted',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const res = await expectJson(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'incident',
            title: `${marker} unknown`,
            status: 'investigating',
            affectedComponents: [
              { componentId: generateId('status_component'), componentStatus: 'major_outage' },
            ],
            body: 'x',
          },
        }),
        400
      )
      expect(res.error.message).not.toMatch(/deleted/i)
      await api.dispose()
    }
  )

  test(
    'API-R-133 a logged past incident keeps its dates and touches nothing live',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const subscriber = await seedStatusSubscriber(marker, [service.id])
      const startedAt = '2024-03-01T10:00:00.000Z'
      const resolvedAt = '2024-03-01T12:00:00.000Z'
      const past = (
        await expectJson(
          await api.post('/api/v1/status/incidents', {
            data: {
              kind: 'incident',
              title: `${marker} last spring`,
              status: 'resolved',
              backfill: { startedAt, resolvedAt },
              affectedComponents: [{ componentId: service.id, componentStatus: 'major_outage' }],
              body: 'It happened',
            },
          }),
          201
        )
      ).data
      expect(past).toMatchObject({ backfilled: true, notifiedAt: null, startedAt, resolvedAt })
      expect(past.updates[0].createdAt).toBe(resolvedAt)
      expect(await serviceStatus(api, service.id)).toBe('operational')
      expect(await eventsMentioning(past.id, 'status.incident_created')).toEqual([])
      const summary = await expectJson(await api.get('/api/v1/status/summary'), 200)
      expect(summary.data.activeIncidents.map((i: Wire) => i.id)).not.toContain(past.id)
      const history = await expectJson(
        await api.get('/api/v1/status/incidents?state=resolved&limit=100'),
        200
      )
      expect(history.data.map((i: Wire) => i.id)).toContain(past.id)
      expect(await mailTo(subscriber.email)).toEqual([])
      await api.dispose()
    }
  )

  test(
    'API-R-135 incident update refusals: missing, malformed, wrong status, empty body, reopening a backfill',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const service = await createService(api, `${marker} svc`)
      const opened: Wire[] = []
      try {
        const incident = await openIncident(api, service.id, `${marker} open`)
        opened.push(incident)
        const missing = await postUpdate(
          api,
          generateId('status_incident'),
          { status: 'monitoring', body: 'x' },
          404
        )
        expect(missing.error).toMatchObject({
          code: 'NOT_FOUND',
          message: 'Status incident not found',
        })
        const malformed = await postUpdate(api, 'nope', { status: 'monitoring', body: 'x' }, 400)
        expect(malformed.error.message).toBe('Invalid incident ID format')
        const wrong = await postUpdate(api, incident.id, { status: 'completed', body: 'x' }, 400)
        expect(wrong.error.message).toBe(
          '"completed" is not an incident status. Use one of: investigating, identified, monitoring, resolved.'
        )
        const empty = await postUpdate(api, incident.id, { status: 'monitoring', body: '' }, 400)
        expect(empty.error.details.errors.body).toEqual(['Update body is required'])

        const past = (
          await expectJson(
            await api.post('/api/v1/status/incidents', {
              data: {
                kind: 'incident',
                title: `${marker} past`,
                status: 'resolved',
                backfill: {
                  startedAt: '2024-03-01T10:00:00.000Z',
                  resolvedAt: '2024-03-01T11:00:00.000Z',
                },
                affectedComponents: [{ componentId: service.id, componentStatus: 'major_outage' }],
                body: 'Past',
              },
            }),
            201
          )
        ).data
        const reopen = await postUpdate(api, past.id, { status: 'investigating', body: 'x' }, 400)
        expect(reopen.error.message).toBe(
          "A logged past incident can't be reopened. Report a new incident instead."
        )
        const timeline = await expectJson(
          await api.get(`/api/v1/status/incidents/${incident.id}`),
          200
        )
        expect(timeline.data.updates).toHaveLength(1)
      } finally {
        await closeAll(api, opened)
        await api.dispose()
      }
    }
  )

  test(
    'API-R-126 a status body that is not JSON is refused as bad input, not a server error',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      for (const path of ['/api/v1/status/services', '/api/v1/status/incidents']) {
        const res = await rawJson(api, 'post', path)
        expect(res.status(), await res.text()).toBe(400)
      }
      await api.dispose()
    }
  )
})

test.describe('REST status: scopes and permissions', () => {
  test(
    'API-R-136 status writes are refused without write:feedback, publish or manage; each key keeps what it holds',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api: admin } = await adminApi(playwright, baseURL, people)
      const service = await createService(admin, `${marker} svc`)
      const opened: Wire[] = []
      const scopes = ['read:feedback', 'write:feedback']
      const { api: readOnly } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:feedback'],
      })
      newTeammate(`Status manager ${marker}`, ['status_page.manage'])
      const publisher = newTeammate(`Status publisher ${marker}`, ['status_page.publish'])
      // A personal key is capped by its creator's legacy role preset, and a
      // member's preset holds no workspace-admin permission (status_page.manage
      // among them), so the manager acts through a workspace key on their role.
      const managerApi = await apiFor(
        playwright,
        baseURL,
        createKey({
          creatorEmail: people.people.admin.email,
          kind: 'workspace',
          roleKey: roleKeyOf(`Status manager ${marker}`),
          scopes,
        }).key
      )
      const publisherApi = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: publisher.email, kind: 'personal', scopes }).key
      )
      const incidentBody = {
        kind: 'incident',
        title: `${marker} refused`,
        status: 'investigating',
        affectedComponents: [{ componentId: service.id, componentStatus: 'partial_outage' }],
        body: 'x',
      }
      try {
        const a = await expectJson(
          await readOnly.post('/api/v1/status/incidents', { data: incidentBody }),
          403
        )
        expect(a.error).toMatchObject({
          code: 'FORBIDDEN',
          message: missingScope('write:feedback', 'status_page.publish'),
        })
        const b = await expectJson(
          await managerApi.post('/api/v1/status/incidents', { data: incidentBody }),
          403
        )
        expect(b.error).toMatchObject({
          code: 'FORBIDDEN',
          message: "Requires the 'status_page.publish' permission",
        })
        const c = await expectJson(
          await publisherApi.patch(`/api/v1/status/services/${service.id}`, {
            data: { status: 'major_outage' },
          }),
          403
        )
        expect(c.error).toMatchObject({
          code: 'FORBIDDEN',
          message: "Requires the 'status_page.manage' permission",
        })
        const [{ n }] = await supportDb()<{ n: number }[]>`
          SELECT count(*)::int AS n FROM status_incidents WHERE title LIKE ${`${marker}%`}`
        expect(n).toBe(0)
        expect(await serviceStatus(admin, service.id)).toBe('operational')

        // Positive controls: each key does what its permission allows.
        const renamed = await expectJson(
          await managerApi.patch(`/api/v1/status/services/${service.id}`, {
            data: { name: `${marker} renamed` },
          }),
          200
        )
        expect(renamed.data.name).toBe(`${marker} renamed`)
        const published = await expectJson(
          await publisherApi.post('/api/v1/status/incidents', {
            data: { ...incidentBody, title: `${marker} allowed` },
          }),
          201
        )
        opened.push(published.data)
        expect(published.data.createdBy).not.toBeNull()
      } finally {
        await closeAll(admin, opened)
        for (const api of [admin, readOnly, managerApi, publisherApi]) await api.dispose()
      }
    }
  )
})
