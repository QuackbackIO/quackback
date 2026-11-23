/**
 * Outgoing webhooks for changelog and status page events. Journeys API-W-29,
 * 61, 62, 66, 67, 68, 70.
 *
 * Each test subscribes on its own sink channels (deleted in `finally`) and
 * reads only deliveries naming its own entries, incidents and services.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { mcpCall } from '../../support/api-client'
import { callServerFn, personApi } from '../../support/server-fns'
import { sink } from '../../support/webhook-sink-client'
import { bodyOf } from '../../support/webhooks'
import {
  adminApi,
  delivered,
  expectNone,
  is,
  json,
  newBoard,
  newPost,
  withHook,
  type Api,
  type Json,
} from '../../product/webhooks'

test.describe.configure({ timeout: 90_000 })

type Body = Record<string, Json & Record<string, unknown>>
const data = (d: Parameters<typeof bodyOf>[0]) => bodyOf<Body>(d).data

const HOUR = 3_600_000

async function newService(api: Api, name: string): Promise<{ id: string; name: string }> {
  const { data: service } = await json<{ data: { id: string; name: string } }>(
    await api.post('/api/v1/status/services', { data: { name } }),
    201
  )
  return service
}

async function newIncident(api: Api, body: Json): Promise<{ id: string }> {
  const { data: incident } = await json<{ data: { id: string } }>(
    await api.post('/api/v1/status/incidents', { data: body }),
    201
  )
  return incident
}

async function postUpdate(api: Api, id: string, status: string, body: string): Promise<void> {
  await json(
    await api.post(`/api/v1/status/incidents/${id}/updates`, { data: { status, body } }),
    201
  )
}

test.describe('changelog events', () => {
  test(
    'API-W-61 changelog.published when an entry is published over REST or MCP',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(api, marker, ['changelog.published'], async () => {
          const linked = [
            await newPost(api, board.id, `Shipped one ${marker}`),
            await newPost(api, board.id, `Shipped two ${marker}`),
          ]
          const content = `${'Release notes '.repeat(20)}${marker}`
          const publishedAt = new Date(Date.now() - 60_000).toISOString()
          const { data: entry } = await json<{ data: { id: string; title: string } }>(
            await api.post('/api/v1/changelog', {
              data: {
                title: `Release ${marker}`,
                content,
                publishedAt,
                linkedPostIds: linked.map((p) => p.id),
              },
            }),
            201
          )
          const [d] = await delivered(marker, 'changelog.published', entry.id)
          expect(data(d).changelog).toEqual({
            id: entry.id,
            title: `Release ${marker}`,
            contentPreview: content.slice(0, 200),
            contentHtml: expect.stringContaining('Release notes'),
            publishedAt,
            linkedPostCount: 2,
          })
          const [row] = await supportDb()`SELECT notified_at FROM changelog_entries
            WHERE id = ${toUuid(entry.id as `changelog_${string}`)}`
          expect(row.notified_at).not.toBeNull()

          const mcp = await mcpCall(api, 'create_changelog', {
            title: `MCP release ${marker}`,
            content: `Published from MCP ${marker}`,
            publish: true,
          })
          expect(mcp.isError, mcp.text).toBe(false)
          const [m] = await delivered(marker, 'changelog.published', String(mcp.json.id))
          expect(data(m).changelog).toMatchObject({
            title: `MCP release ${marker}`,
            linkedPostCount: 0,
          })
        })
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-62 publishing again after moving to draft sends nothing; edits send nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        await withHook(api, marker, ['changelog.published'], async () => {
          const now = () => new Date(Date.now() - 1_000).toISOString()
          const { data: entry } = await json<{ data: { id: string } }>(
            await api.post('/api/v1/changelog', {
              data: { title: `Once ${marker}`, content: 'First', publishedAt: now() },
            }),
            201
          )
          await delivered(marker, 'changelog.published', entry.id)
          const patch = (body: Json) =>
            api.patch(`/api/v1/changelog/${entry.id}`, { data: body }).then((r) => json(r, 200))
          await patch({ publishedAt: null })
          await patch({ publishedAt: now() })
          await patch({ title: `Once edited ${marker}` })

          const { data: control } = await json<{ data: { id: string } }>(
            await api.post('/api/v1/changelog', {
              data: { title: `Control ${marker}`, content: 'Control', publishedAt: now() },
            }),
            201
          )
          await delivered(marker, 'changelog.published', control.id)
          await expectNone(
            marker,
            (d) =>
              d.body.includes(entry.id) && d.headers['x-quackback-event'] !== 'changelog.published',
            'edits'
          )
          expect(
            (await sink.deliveries(marker)).filter(is('changelog.published', entry.id))
          ).toHaveLength(1)
        })
      } finally {
        await api.dispose()
      }
    }
  )
})

test.describe('status page events', () => {
  test(
    'API-W-66 status.incident_created fires with email on or off; a backfill never fires',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const s1 = await newService(api, `API ${marker}`)
      const s2 = await newService(api, `Web ${marker}`)
      try {
        await withHook(api, marker, ['status.incident_created'], async () => {
          const affected = [s1, s2].map((s) => ({
            componentId: s.id,
            componentStatus: 'degraded_performance',
          }))
          const loud = await newIncident(api, {
            kind: 'incident',
            title: `Outage ${marker}`,
            status: 'investigating',
            impact: 'minor',
            affectedComponents: affected,
            body: 'Looking into it',
          })
          const [d] = await delivered(marker, 'status.incident_created', loud.id)
          expect(data(d).incident).toMatchObject({
            id: loud.id,
            kind: 'incident',
            title: `Outage ${marker}`,
            status: 'investigating',
            impact: 'minor',
            scheduledStartAt: null,
            scheduledEndAt: null,
            startedAt: expect.any(String),
            notifySubscribers: true,
          })
          expect([...(data(d).incident.componentIds as string[])].sort()).toEqual(
            [s1.id, s2.id].sort()
          )

          const quiet = await newIncident(api, {
            kind: 'incident',
            title: `Quiet ${marker}`,
            status: 'investigating',
            affectedComponents: affected.slice(0, 1),
            body: 'No email',
            notifySubscribers: false,
          })
          const [q] = await delivered(marker, 'status.incident_created', quiet.id)
          expect(data(q).incident.notifySubscribers).toBe(false)

          const backfill = await newIncident(api, {
            kind: 'incident',
            title: `History ${marker}`,
            status: 'resolved',
            affectedComponents: affected.slice(0, 1),
            body: 'Logged later',
            backfill: {
              startedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
              resolvedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
            },
          })
          const control = await newIncident(api, {
            kind: 'incident',
            title: `Control ${marker}`,
            status: 'investigating',
            affectedComponents: affected.slice(1),
            body: 'Control',
          })
          await delivered(marker, 'status.incident_created', control.id)
          await expectNone(marker, (x) => x.body.includes(backfill.id), 'backfilled incident')
          const rows =
            await supportDb()`SELECT id FROM events WHERE payload::text LIKE ${`%${backfill.id}%`}`
          expect(rows).toHaveLength(0)
        })
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-67 maintenance created scheduled, already running or already done',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const service = await newService(api, `Maint ${marker}`)
      const affected = [{ componentId: service.id, componentStatus: 'under_maintenance' }]
      const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString()
      try {
        await withHook(
          api,
          marker,
          [
            'status.maintenance_scheduled',
            'status.maintenance_started',
            'status.maintenance_completed',
          ],
          async () => {
            const later = await newIncident(api, {
              kind: 'maintenance',
              title: `Tomorrow ${marker}`,
              status: 'scheduled',
              affectedComponents: affected,
              body: 'Planned',
              scheduledStartAt: at(24),
              scheduledEndAt: at(26),
            })
            const running = await newIncident(api, {
              kind: 'maintenance',
              title: `Running ${marker}`,
              status: 'in_progress',
              affectedComponents: affected,
              body: 'Under way',
              scheduledStartAt: at(-1),
              scheduledEndAt: at(1),
            })
            const done = await newIncident(api, {
              kind: 'maintenance',
              title: `Done ${marker}`,
              status: 'completed',
              affectedComponents: affected,
              body: 'Finished',
              scheduledStartAt: at(-3),
              scheduledEndAt: at(-2),
            })
            const [s] = await delivered(marker, 'status.maintenance_scheduled', later.id)
            expect(data(s).incident).toMatchObject({
              kind: 'maintenance',
              scheduledStartAt: expect.any(String),
              scheduledEndAt: expect.any(String),
              componentIds: [service.id],
            })
            await delivered(marker, 'status.maintenance_scheduled', running.id)
            const [started] = await delivered(marker, 'status.maintenance_started', running.id)
            expect(data(started)).toEqual({
              incidentId: running.id,
              title: `Running ${marker}`,
              componentIds: [service.id],
            })
            await delivered(marker, 'status.maintenance_scheduled', done.id)
            await delivered(marker, 'status.maintenance_completed', done.id)
            await expectNone(
              marker,
              (d) =>
                d.body.includes(later.id) &&
                d.headers['x-quackback-event'] !== 'status.maintenance_scheduled',
              'a window still scheduled has made no transition'
            )
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-68 status.incident_updated on each update; maintenance start and completion once each',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const service = await newService(api, `Updates ${marker}`)
      try {
        await withHook(
          api,
          marker,
          ['status.incident_updated', 'status.maintenance_started', 'status.maintenance_completed'],
          async () => {
            const incident = await newIncident(api, {
              kind: 'incident',
              title: `Incident ${marker}`,
              status: 'investigating',
              affectedComponents: [{ componentId: service.id, componentStatus: 'partial_outage' }],
              body: 'Investigating',
            })
            await postUpdate(api, incident.id, 'monitoring', `Fix deployed ${marker}`)
            const [u] = await delivered(marker, 'status.incident_updated', incident.id)
            expect(data(u)).toEqual({
              incidentId: incident.id,
              kind: 'incident',
              status: 'monitoring',
              body: `Fix deployed ${marker}`,
            })

            const maint = await newIncident(api, {
              kind: 'maintenance',
              title: `Window ${marker}`,
              status: 'scheduled',
              affectedComponents: [
                { componentId: service.id, componentStatus: 'under_maintenance' },
              ],
              body: 'Planned',
              scheduledStartAt: new Date(Date.now() + 24 * HOUR).toISOString(),
              scheduledEndAt: new Date(Date.now() + 26 * HOUR).toISOString(),
            })
            await postUpdate(api, maint.id, 'in_progress', `Starting ${marker}`)
            await delivered(marker, 'status.maintenance_started', maint.id)
            await postUpdate(api, maint.id, 'completed', `All done ${marker}`)
            await delivered(marker, 'status.maintenance_completed', maint.id)
            const updates = await delivered(marker, 'status.incident_updated', maint.id, {
              count: 2,
            })
            expect(updates.map((d) => data(d).status).sort()).toEqual(['completed', 'in_progress'])
            await new Promise((r) => setTimeout(r, 2_000))
            const all = await sink.deliveries(marker)
            expect(all.filter(is('status.maintenance_started', maint.id))).toHaveLength(1)
            expect(all.filter(is('status.maintenance_completed', maint.id))).toHaveLength(1)
            expect(all.filter(is('status.incident_updated', maint.id))).toHaveLength(2)
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-70 status.component_changed for a manual and an API change, not for a repeat',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const service = await newService(api, `Component ${marker}`)
      const admin = await personApi(playwright, 'admin')
      try {
        await withHook(api, marker, ['status.component_changed'], async () => {
          const manual = await callServerFn(admin, 'setStatusComponentStatusFn', {
            id: service.id,
            status: 'degraded_performance',
          })
          expect(manual.ok, manual.error).toBe(true)
          const [m] = await delivered(marker, 'status.component_changed', service.id)
          expect(data(m)).toEqual({
            componentId: service.id,
            componentName: service.name,
            previousStatus: 'operational',
            status: 'degraded_performance',
            source: 'manual',
          })

          const patch = (status: string) =>
            api
              .patch(`/api/v1/status/services/${service.id}`, { data: { status } })
              .then((r) => json(r, 200))
          await patch('major_outage')
          await patch('major_outage')
          await patch('operational')
          const ds = await delivered(marker, 'status.component_changed', service.id, { count: 3 })
          expect(ds.slice(1).map((d) => data(d))).toEqual([
            expect.objectContaining({
              previousStatus: 'degraded_performance',
              status: 'major_outage',
              source: 'api',
            }),
            expect.objectContaining({
              previousStatus: 'major_outage',
              status: 'operational',
              source: 'api',
            }),
          ])
          await new Promise((r) => setTimeout(r, 2_000))
          expect(
            (await sink.deliveries(marker)).filter(is('status.component_changed', service.id))
          ).toHaveLength(3)
        })
      } finally {
        await admin.dispose()
        await api.dispose()
      }
    }
  )

  test(
    'API-W-29 changelog and status events ignore a board filter',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const service = await newService(api, `Filter ${marker}`)
      try {
        await withHook(
          api,
          marker,
          ['changelog.published', 'status.incident_created'],
          async () => {
            const { data: entry } = await json<{ data: { id: string } }>(
              await api.post('/api/v1/changelog', {
                data: {
                  title: `Filtered ${marker}`,
                  content: 'Board filter ignored',
                  publishedAt: new Date(Date.now() - 1_000).toISOString(),
                },
              }),
              201
            )
            const incident = await newIncident(api, {
              kind: 'incident',
              title: `Filtered ${marker}`,
              status: 'investigating',
              affectedComponents: [
                { componentId: service.id, componentStatus: 'degraded_performance' },
              ],
              body: 'Board filter ignored',
            })
            await delivered(marker, 'changelog.published', entry.id)
            await delivered(marker, 'status.incident_created', incident.id)
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )
})
