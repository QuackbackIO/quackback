/**
 * The status REST API (/api/v1/status/*).
 *
 * Journeys: STA-X-01, STA-X-02, STA-X-03, STA-X-04, STA-X-05, STA-X-06,
 * STA-X-07, STA-X-08, STA-X-09, STA-X-10.
 *
 * Keys are minted per test (personal keys of the seeded people, or a
 * workspace key). Lists are workspace-wide: each test finds its own rows.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { apiFor, createKey, expectJson, type Wire } from '../../support/api-client'
import { supportEnv } from '../../support/env'
import {
  createService,
  deleteMadeIncidents,
  domainEvents,
  incidentRow,
  maintenanceJobs,
  must,
  serviceEvents,
  serviceRow,
} from '../../product/status'

let admin: APIRequestContext
const opened: APIRequestContext[] = []

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
})
test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.dispose()
  await deleteMadeIncidents(admin)
  await admin.dispose()
})

type Person = 'admin' | 'contributor' | 'noAccess'

/** The principal of the key keyApi made last (a key acts as its own principal). */
let lastKeyPrincipal = ''

async function keyApi(
  playwright: Parameters<typeof apiFor>[0],
  people: { people: Record<Person, { email: string }> },
  who: Person | 'workspace'
): Promise<APIRequestContext> {
  const created =
    who === 'workspace'
      ? createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      : createKey({ creatorEmail: people.people[who].email, kind: 'personal' })
  lastKeyPrincipal = created.principalId
  const api = await apiFor(playwright, supportEnv().baseUrl, created.key)
  opened.push(api)
  return api
}

/** Incidents created over REST are deleted after the test too. */
async function deleteRestIncident(id: string) {
  await must(admin, 'deleteStatusIncidentFn', { id }).catch(() => {})
}

test('STA-X-01 the summary endpoint', { tag: '@core' }, async ({ playwright, people, marker }) => {
  const api = await keyApi(playwright, people, 'admin')
  const svc = await createService(admin, `${marker} Summary`, { description: 'desc' })
  const res = await expectJson<Wire>(await api.get('/api/v1/status/summary'), 200)
  expect(typeof res.data.status).toBe('string')
  const mine = res.data.components.find((c: Wire) => c.id === svc.id)
  expect(mine).toEqual({
    id: svc.id,
    name: `${marker} Summary`,
    description: 'desc',
    status: 'operational',
    showUptime: true,
  })
  expect(Array.isArray(res.data.activeIncidents)).toBe(true)
  const anon = await apiFor(playwright, supportEnv().baseUrl, null)
  opened.push(anon)
  const none = await anon.get('/api/v1/status/summary')
  expect(none.status()).toBe(401)
  expect(none.headers()['www-authenticate']).toBeTruthy()
})

test('STA-X-02 list and get services', { tag: '@core' }, async ({ playwright, people, marker }) => {
  const api = await keyApi(playwright, people, 'noAccess')
  const svc = await createService(admin, `${marker} Listed`)
  const gone = await createService(admin, `${marker} Gone`)
  await must(admin, 'deleteStatusComponentFn', { id: gone.id })
  for (const path of ['/api/v1/status/services', '/api/v1/status/components']) {
    const list = await expectJson<Wire>(await api.get(path), 200)
    const row = list.data.find((c: Wire) => c.id === svc.id)
    expect(row).toEqual({
      id: svc.id,
      groupId: null,
      name: `${marker} Listed`,
      description: null,
      status: 'operational',
      position: expect.any(Number),
      showUptime: true,
      segmentIds: [],
    })
    expect(list.data.map((c: Wire) => c.id)).not.toContain(gone.id)
  }
  const one = await expectJson<Wire>(await api.get(`/api/v1/status/services/${svc.id}`), 200)
  expect(one.data.id).toBe(svc.id)
  const missing = await expectJson<Wire>(await api.get(`/api/v1/status/services/${gone.id}`), 404)
  expect(missing.error.message).toMatch(/Status component not found/)
  const bad = await expectJson<Wire>(await api.get('/api/v1/status/services/not-an-id'), 400)
  expect(bad.error.code).toBe('VALIDATION_ERROR')
})

test(
  'STA-X-03 create a service over REST',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'admin')
    const created = await expectJson<Wire>(
      await api.post('/api/v1/status/services', {
        data: { name: `${marker} Rest`, description: 'from rest', showUptime: false },
      }),
      201
    )
    expect(created.data).toMatchObject({
      name: `${marker} Rest`,
      description: 'from rest',
      showUptime: false,
      status: 'operational',
    })
    expect((await serviceRow(created.data.id)).name).toBe(`${marker} Rest`)

    const badGroup = await expectJson<Wire>(
      await api.post('/api/v1/status/services', { data: { name: `${marker} x`, groupId: 'nope' } }),
      400
    )
    expect(badGroup.error.message).toMatch(/Invalid groupId format/)
    const noName = await expectJson<Wire>(
      await api.post('/api/v1/status/services', { data: {} }),
      400
    )
    expect(noName.error.message).toBe('Invalid request body')
    expect(noName.error.details.errors.name).toBeTruthy()

    const contributor = await keyApi(playwright, people, 'contributor')
    const refused = await expectJson<Wire>(
      await contributor.post('/api/v1/status/services', { data: { name: `${marker} nope` } }),
      403
    )
    expect(refused.error.code).toBe('FORBIDDEN')
    const list = await expectJson<Wire>(await api.get('/api/v1/status/services'), 200)
    expect(list.data.map((c: Wire) => c.name)).not.toContain(`${marker} nope`)
  }
)

test(
  'STA-X-04 a service created with a non-operational status records it',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'createStatusComponent (status.components.ts:176) writes no status_component_events row and no status.component_changed for an initial non-operational status; see QUARANTINE.md (STA-P-15)',
    },
  },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'admin')
    const created = await expectJson<Wire>(
      await api.post('/api/v1/status/services', {
        data: { name: `${marker} Down`, status: 'major_outage' },
      }),
      201
    )
    expect(created.data.status).toBe('major_outage')
    expect(await serviceEvents(created.data.id)).toEqual([
      expect.objectContaining({ status: 'major_outage' }),
    ])
    expect((await domainEvents(created.data.id)).map((e) => e.type)).toEqual([
      'status.component_changed',
    ])
  }
)

test(
  'STA-X-05 drive a service status from a monitor (PATCH)',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'admin')
    const svc = await createService(admin, `${marker} Monitored`)
    const path = `/api/v1/status/services/${svc.id}`
    const first = await expectJson<Wire>(
      await api.patch(path, { data: { status: 'partial_outage' } }),
      200
    )
    expect(first.data.status).toBe('partial_outage')
    expect(await serviceEvents(svc.id)).toEqual([
      expect.objectContaining({ status: 'partial_outage', source: 'api' }),
    ])
    const events = await domainEvents(svc.id)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'status.component_changed', actor_type: 'service' })
    expect(events[0].payload).toMatchObject({
      componentId: svc.id,
      componentName: `${marker} Monitored`,
      previousStatus: 'operational',
      status: 'partial_outage',
      source: 'api',
    })
    await expectJson(await api.patch(path, { data: { status: 'partial_outage' } }), 200)
    expect(await serviceEvents(svc.id)).toHaveLength(1)

    const both = await expectJson<Wire>(
      await api.patch(path, { data: { name: `${marker} Renamed`, status: 'operational' } }),
      200
    )
    expect(both.data).toMatchObject({ name: `${marker} Renamed`, status: 'operational' })
    const empty = await expectJson<Wire>(await api.patch(path, { data: {} }), 400)
    expect(empty.error.message).toBe('At least one field is required')

    const contributor = await keyApi(playwright, people, 'contributor')
    await expectJson(await contributor.patch(path, { data: { status: 'major_outage' } }), 403)
    await must(admin, 'deleteStatusComponentFn', { id: svc.id })
    await expectJson(await api.patch(path, { data: { status: 'major_outage' } }), 404)
  }
)

test(
  'STA-X-06 incident list paging answers bad limits and cursors cleanly',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'GET /api/v1/status/incidents parses limit itself (incidents/index.ts:64) without the shared pagination guard: limit=0 reports hasMore with no cursor and a negative or non-numeric limit, or a garbage cursor, fails with 500; see QUARANTINE.md',
    },
  },
  async ({ playwright, people }) => {
    const api = await keyApi(playwright, people, 'admin')
    const zero = await api.get('/api/v1/status/incidents?limit=0')
    if (zero.status() === 200) {
      const body = (await zero.json()) as Wire
      expect(body.meta?.pagination?.hasMore && !body.meta?.pagination?.cursor).toBeFalsy()
    }
    for (const q of ['limit=-1', 'limit=abc', 'cursor=garbage']) {
      const res = await api.get(`/api/v1/status/incidents?${q}`)
      expect(res.status(), q).toBeLessThan(500)
    }
  }
)

test(
  'STA-X-06 list incidents over REST',
  { tag: '@nightly' },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'admin')
    const svc = await createService(admin, `${marker} Listed`)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const res = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'maintenance',
            title: `${marker} window ${i}`,
            status: 'scheduled',
            body: 'planned',
            notifySubscribers: false,
            scheduledStartAt: new Date(Date.now() + 3_600_000).toISOString(),
            scheduledEndAt: new Date(Date.now() + 7_200_000).toISOString(),
            affectedComponents: [{ componentId: svc.id, componentStatus: 'under_maintenance' }],
          },
        }),
        201
      )
      ids.push(res.data.id)
    }
    try {
      const page1 = await expectJson<Wire>(
        await api.get('/api/v1/status/incidents?kind=maintenance&state=active&limit=2'),
        200
      )
      expect(page1.data).toHaveLength(2)
      expect(page1.data.every((i: Wire) => i.kind === 'maintenance')).toBe(true)
      // Newest first: ours are the newest windows unless another test races.
      expect(page1.meta.pagination.hasMore).toBe(true)
      const page2 = await expectJson<Wire>(
        await api.get(
          `/api/v1/status/incidents?kind=maintenance&state=active&limit=2&cursor=${page1.meta.pagination.cursor}`
        ),
        200
      )
      const seen = [...page1.data, ...page2.data].map((i: Wire) => i.id)
      expect(new Set(seen).size).toBe(seen.length)
      const ignored = await expectJson<Wire>(
        await api.get('/api/v1/status/incidents?kind=bogus&state=bogus&limit=1'),
        200
      )
      expect(ignored.data).toHaveLength(1)
    } finally {
      for (const id of ids) await deleteRestIncident(id)
    }
  }
)

test(
  'STA-X-07 create an incident or window over REST',
  { tag: '@smoke' },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'admin')
    const svc = await createService(admin, `${marker} Rest svc`)
    const made: string[] = []
    try {
      const inc = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'incident',
            title: `${marker} rest incident`,
            status: 'investigating',
            body: 'From a monitor',
            notifySubscribers: false,
            affectedComponents: [{ componentId: svc.id, componentStatus: 'major_outage' }],
          },
        }),
        201
      )
      made.push(inc.data.id)
      expect(inc.data).toMatchObject({
        kind: 'incident',
        status: 'investigating',
        impact: 'critical',
      })
      // The key's own principal.
      expect(inc.data.createdBy).toBe(lastKeyPrincipal)
      expect(inc.data.notifiedAt).not.toBeNull()
      expect(inc.data).not.toHaveProperty('notifySubscribers')
      expect((await serviceRow(svc.id)).status).toBe('major_outage')
      expect((await domainEvents(inc.data.id)).map((e) => e.type)).toEqual([
        'status.incident_created',
      ])

      const win = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'maintenance',
            title: `${marker} rest window`,
            status: 'scheduled',
            body: 'Planned',
            notifySubscribers: false,
            scheduledStartAt: new Date(Date.now() + 3_600_000).toISOString(),
            scheduledEndAt: new Date(Date.now() + 7_200_000).toISOString(),
            affectedComponents: [{ componentId: svc.id, componentStatus: 'under_maintenance' }],
          },
        }),
        201
      )
      made.push(win.data.id)
      expect((await maintenanceJobs(win.data.id)).map((j) => j.kind)).toEqual(['complete', 'start'])

      const past = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'incident',
            title: `${marker} rest past`,
            status: 'resolved',
            body: 'History',
            backfill: {
              startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
              resolvedAt: new Date(Date.now() - 86_400_000).toISOString(),
            },
            affectedComponents: [{ componentId: svc.id, componentStatus: 'major_outage' }],
          },
        }),
        201
      )
      made.push(past.data.id)
      expect(past.data.notifiedAt).toBeNull()
      expect((await incidentRow(past.data.id)).backfilled).toBe(true)

      // Refusals.
      const noDate = await api.post('/api/v1/status/incidents', {
        data: {
          kind: 'maintenance',
          title: marker,
          status: 'scheduled',
          body: 'x',
          scheduledStartAt: 'tomorrow',
          affectedComponents: [{ componentId: svc.id, componentStatus: 'under_maintenance' }],
        },
      })
      expect(noDate.status()).toBe(400)
      const mismatch = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'incident',
            title: marker,
            status: 'scheduled',
            body: 'x',
            affectedComponents: [{ componentId: svc.id, componentStatus: 'major_outage' }],
          },
        }),
        400
      )
      expect(mismatch.error.code).toBe('VALIDATION_ERROR')
      const badId = await api.post('/api/v1/status/incidents', {
        data: {
          kind: 'incident',
          title: marker,
          status: 'investigating',
          body: 'x',
          affectedComponents: [{ componentId: 'nope', componentStatus: 'major_outage' }],
        },
      })
      expect(badId.status()).toBe(400)
      const gone = await createService(admin, `${marker} Gone`)
      await must(admin, 'deleteStatusComponentFn', { id: gone.id })
      const deleted = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'incident',
            title: marker,
            status: 'investigating',
            body: 'x',
            affectedComponents: [{ componentId: gone.id, componentStatus: 'major_outage' }],
          },
        }),
        400
      )
      expect(deleted.error.message).toBe(
        'An affected service has been deleted. Choose the services again.'
      )
    } finally {
      for (const id of made) await deleteRestIncident(id)
    }
  }
)

test(
  'STA-X-08 get one incident over REST',
  { tag: '@nightly' },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'noAccess')
    const a = await createService(admin, `${marker} A`)
    const b = await createService(admin, `${marker} B`)
    const inc = await must<{ id: string }>(admin, 'createStatusIncidentFn', {
      kind: 'incident',
      title: marker,
      status: 'investigating',
      body: 'first',
      notifySubscribers: false,
      affectedComponents: [
        { componentId: a.id, componentStatus: 'major_outage' },
        { componentId: b.id, componentStatus: 'major_outage' },
      ],
    })
    try {
      await must(admin, 'postStatusIncidentUpdateFn', {
        id: inc.id,
        status: 'identified',
        body: 'second',
      })
      await must(admin, 'deleteStatusComponentFn', { id: b.id })
      const got = await expectJson<Wire>(await api.get(`/api/v1/status/incidents/${inc.id}`), 200)
      expect(got.data.updates.map((u: Wire) => u.body)).toEqual(['first', 'second'])
      expect(got.data.affectedComponents.map((c: Wire) => c.componentId ?? c.id)).toEqual([a.id])
      await must(admin, 'deleteStatusIncidentFn', { id: inc.id })
      const missing = await expectJson<Wire>(
        await api.get(`/api/v1/status/incidents/${inc.id}`),
        404
      )
      expect(missing.error.message).toMatch(/Status incident not found/)
      await expectJson(await api.get('/api/v1/status/incidents/garbage'), 400)
    } finally {
      await deleteRestIncident(inc.id)
    }
  }
)

test(
  'STA-X-09 post an update over REST',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const api = await keyApi(playwright, people, 'contributor')
    const one = await createService(admin, `${marker} One`)
    const two = await createService(admin, `${marker} Two`)
    const create = async (svc: string, title: string) =>
      (
        await expectJson<Wire>(
          await api.post('/api/v1/status/incidents', {
            data: {
              kind: 'incident',
              title,
              status: 'investigating',
              body: 'x',
              notifySubscribers: false,
              affectedComponents: [{ componentId: svc, componentStatus: 'major_outage' }],
            },
          }),
          201
        )
      ).data.id as string
    const a = await create(one.id, `${marker} a`)
    const b = await create(two.id, `${marker} b`)
    try {
      await expectJson(
        await api.post(`/api/v1/status/incidents/${a}/updates`, {
          data: { status: 'resolved', body: 'fixed' },
        }),
        201
      )
      expect((await serviceRow(one.id)).status).toBe('operational')
      await expectJson(
        await api.post(`/api/v1/status/incidents/${b}/updates`, {
          data: { status: 'resolved', body: 'partly', skipRestore: true },
        }),
        201
      )
      expect((await serviceRow(two.id)).status).toBe('major_outage')
      const kind = await expectJson<Wire>(
        await api.post(`/api/v1/status/incidents/${a}/updates`, {
          data: { status: 'completed', body: 'x' },
        }),
        400
      )
      expect(kind.error.message).toMatch(/"completed" is not an incident status/)
      const past = await expectJson<Wire>(
        await api.post('/api/v1/status/incidents', {
          data: {
            kind: 'incident',
            title: `${marker} past`,
            status: 'resolved',
            body: 'x',
            backfill: {
              startedAt: new Date(Date.now() - 86_400_000).toISOString(),
              resolvedAt: new Date(Date.now() - 3_600_000).toISOString(),
            },
            affectedComponents: [{ componentId: one.id, componentStatus: 'major_outage' }],
          },
        }),
        201
      )
      const reopen = await expectJson<Wire>(
        await api.post(`/api/v1/status/incidents/${past.data.id}/updates`, {
          data: { status: 'investigating', body: 'x' },
        }),
        400
      )
      expect(reopen.error.message).toBe(
        "A logged past incident can't be reopened. Report a new incident instead."
      )
      await deleteRestIncident(past.data.id)
      await expectJson(
        await api.post(
          '/api/v1/status/incidents/status_incident_01m7v6aewge02vtv3kd36ggmcw/updates',
          { data: { status: 'resolved', body: 'x' } }
        ),
        404
      )
      for (const id of [a, b]) {
        expect(
          (await domainEvents(id)).filter((e) => e.type === 'status.incident_updated')
        ).toHaveLength(1)
      }
    } finally {
      for (const id of [a, b]) await deleteRestIncident(id)
    }
  }
)

test(
  'STA-X-10 key permissions and scopes',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const svc = await createService(admin, `${marker} Keys`)
    const incidentBody = {
      kind: 'incident',
      title: `${marker} keyed`,
      status: 'investigating',
      body: 'x',
      notifySubscribers: false,
      affectedComponents: [{ componentId: svc.id, componentStatus: 'degraded_performance' }],
    }
    const made: string[] = []
    try {
      for (const who of ['noAccess', 'contributor', 'admin', 'workspace'] as const) {
        const api = await keyApi(playwright, people, who)
        for (const path of [
          '/api/v1/status/summary',
          '/api/v1/status/services',
          '/api/v1/status/incidents',
        ]) {
          expect((await api.get(path)).status(), `${who} ${path}`).toBe(200)
        }
        const inc = await api.post('/api/v1/status/incidents', { data: incidentBody })
        const svcPatch = await api.patch(`/api/v1/status/services/${svc.id}`, {
          data: { description: who },
        })
        if (who === 'noAccess') {
          expect(inc.status()).toBe(403)
          expect(((await inc.json()) as Wire).error.message).toMatch(
            /Requires the 'status_page.publish' permission/
          )
          expect(svcPatch.status()).toBe(403)
        } else if (who === 'contributor') {
          expect(inc.status()).toBe(201)
          made.push(((await inc.json()) as Wire).data.id)
          expect(svcPatch.status()).toBe(403)
          expect(((await svcPatch.json()) as Wire).error.message).toMatch(
            /Requires the 'status_page.manage' permission/
          )
        } else {
          expect(inc.status(), who).toBe(201)
          made.push(((await inc.json()) as Wire).data.id)
          expect(svcPatch.status(), who).toBe(200)
        }
      }
      // A key scoped to reading feedback cannot write status.
      const scoped = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'personal',
        scopes: ['read:feedback'],
      }).key
      const scopedApi = await apiFor(playwright, supportEnv().baseUrl, scoped)
      opened.push(scopedApi)
      expect(
        (await scopedApi.post('/api/v1/status/incidents', { data: incidentBody })).status()
      ).toBe(403)
    } finally {
      for (const id of made) await deleteRestIncident(id)
    }
  }
)
