/**
 * Incident and maintenance lifecycle against real Postgres: the paths whose
 * correctness depends on the SQL (the reconcile query's active set, the
 * soft-delete filters, transaction rollback) rather than on call order.
 *
 * Event dispatch and the delayed-job scheduler are stubbed; everything else
 * runs for real inside the fixture's always-rolled-back transaction.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type StatusComponentId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  sql,
  principal,
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
} from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockProcessEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/events/process', () => ({
  processEvent: (...args: unknown[]) => mockProcessEvent(...args),
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))

import { createStatusComponent, deleteStatusComponent } from '../status.components'
import {
  createIncident,
  createStatusIncidentTemplate,
  deleteIncident,
  getStatusIncidentById,
  listStatusIncidents,
  listStatusIncidentTemplates,
  notifyStatusIncidentPublished,
  postIncidentUpdate,
  reconcileStatusNotifications,
  updateIncident,
} from '../status.service'
import {
  handleMaintenanceComplete,
  handleMaintenanceStart,
  reconcileMaintenanceWindows,
  startMaintenanceNow,
} from '../status.maintenance'
import { getStatusPageSnapshot } from '../status.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusIncidents.id }).from(statusIncidents).limit(0)
  },
})

const HOUR = 60 * 60 * 1000
let author: PrincipalId

async function service(name: string): Promise<StatusComponentId> {
  return (await createStatusComponent({ name })).id
}

async function openIncident(
  affected: {
    componentId: StatusComponentId
    componentStatus: 'major_outage' | 'degraded_performance'
  }[]
) {
  return createIncident(
    {
      kind: 'incident',
      title: 'Errors',
      status: 'investigating',
      body: 'Looking into it.',
      affectedComponents: affected,
      notifySubscribers: false,
    },
    { principalId: author }
  )
}

async function scheduleWindow(start: Date, end: Date | null) {
  const db = await service('Database')
  return createIncident(
    {
      kind: 'maintenance',
      title: 'Upgrade',
      status: 'scheduled',
      body: 'Planned upgrade.',
      affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
      scheduledStartAt: start,
      scheduledEndAt: end,
      notifySubscribers: false,
    },
    { principalId: author }
  )
}

function isRecent(date: Date) {
  return Math.abs(Date.now() - date.getTime()) < 60_000
}

async function statusOf(id: StatusComponentId) {
  const row = await testDb.query.statusComponents.findFirst({
    where: eq(statusComponents.id, id),
  })
  return row?.status
}

describe('status lifecycle (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    mockProcessEvent.mockReset().mockResolvedValue(undefined)
    await fixture.begin()
    author = createId('principal')
    await testDb
      .insert(principal)
      .values({ id: author, role: 'admin', type: 'service', createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('a service deleted while an incident uses it', () => {
    it('resolving the incident still restores its other services', async () => {
      const api = await service('API')
      const web = await service('Website')
      const incident = await createIncident(
        {
          kind: 'incident',
          title: 'Errors',
          status: 'investigating',
          body: 'Looking into it.',
          affectedComponents: [
            { componentId: api, componentStatus: 'major_outage' },
            { componentId: web, componentStatus: 'partial_outage' },
          ],
          notifySubscribers: false,
        },
        { principalId: author }
      )
      expect(await statusOf(web)).toBe('partial_outage')

      await deleteStatusComponent(api)
      const resolved = await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Fixed.' },
        { principalId: author }
      )

      expect(resolved.status).toBe('resolved')
      expect(resolved.resolvedAt).not.toBeNull()
      expect(await statusOf(web)).toBe('operational')
    })

    it('leaves the deleted service out of the detail, and keeps its link when the editor saves', async () => {
      const api = await service('API')
      const web = await service('Website')
      const incident = await createIncident(
        {
          kind: 'incident',
          title: 'Errors',
          status: 'investigating',
          body: 'Looking into it.',
          affectedComponents: [
            { componentId: api, componentStatus: 'major_outage' },
            { componentId: web, componentStatus: 'partial_outage' },
          ],
          notifySubscribers: false,
        },
        { principalId: author }
      )
      await deleteStatusComponent(api)

      const detail = await getStatusIncidentById(incident.id)
      expect(detail.affectedComponents.map((c) => c.componentId)).toEqual([web])

      // A stale editor still sends the deleted service back; it is ignored
      // rather than relinked, and its existing link survives as history.
      const saved = await updateIncident(incident.id, {
        title: 'Elevated errors',
        affectedComponents: [
          { componentId: api, componentStatus: 'major_outage' },
          { componentId: web, componentStatus: 'degraded_performance' },
        ],
      })
      expect(saved.affectedComponents).toEqual([
        expect.objectContaining({ componentId: web, componentStatus: 'degraded_performance' }),
      ])
      const links = await testDb.query.statusIncidentComponents.findMany({
        where: eq(statusIncidentComponents.incidentId, incident.id),
      })
      expect(links.map((l) => l.componentId).sort()).toEqual([api, web].sort())
      expect(await statusOf(web)).toBe('degraded_performance')
    })

    it('maintenance auto-complete still completes the window and restores the rest', async () => {
      const db = await service('Database')
      const api = await service('API')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Upgrade',
          status: 'in_progress',
          body: 'Upgrading.',
          affectedComponents: [
            { componentId: db, componentStatus: 'under_maintenance' },
            { componentId: api, componentStatus: 'under_maintenance' },
          ],
          scheduledStartAt: new Date(Date.now() - 2 * HOUR),
          scheduledEndAt: new Date(Date.now() - HOUR),
          notifySubscribers: false,
        },
        { principalId: author }
      )
      expect(await statusOf(api)).toBe('under_maintenance')

      await deleteStatusComponent(db)
      await handleMaintenanceComplete(window.id)

      const after = await getStatusIncidentById(window.id)
      expect(after.status).toBe('completed')
      expect(await statusOf(api)).toBe('operational')
    })

    it('templates offer only the services that still exist', async () => {
      const api = await service('API')
      const web = await service('Website')
      await createStatusIncidentTemplate({
        name: 'Outage',
        title: 'Outage',
        body: 'We are investigating.',
        componentIds: [api, web],
      })
      await deleteStatusComponent(api)

      const [template] = await listStatusIncidentTemplates()
      expect(template.componentIds).toEqual([web])
    })
  })

  describe('creating an incident', () => {
    it('rejects a deleted service and writes nothing', async () => {
      const api = await service('API')
      await deleteStatusComponent(api)

      await expect(
        createIncident(
          {
            kind: 'incident',
            title: 'Errors',
            status: 'investigating',
            body: 'Looking into it.',
            affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
          },
          { principalId: author }
        )
      ).rejects.toBeInstanceOf(ValidationError)
      expect(await testDb.query.statusIncidents.findMany()).toEqual([])
    })

    it('is atomic: a failure after the incident row is written leaves nothing behind', async () => {
      const api = await service('API')

      // The same service twice violates the link table's primary key, after
      // the incident row itself has already been inserted.
      await expect(
        createIncident(
          {
            kind: 'incident',
            title: 'Errors',
            status: 'investigating',
            body: 'Looking into it.',
            affectedComponents: [
              { componentId: api, componentStatus: 'major_outage' },
              { componentId: api, componentStatus: 'partial_outage' },
            ],
          },
          { principalId: author }
        )
      ).rejects.toThrow()

      expect(await testDb.query.statusIncidents.findMany()).toEqual([])
      expect(await testDb.query.statusIncidentComponents.findMany()).toEqual([])
      expect(await statusOf(api)).toBe('operational')
    })
  })

  describe('deleting an incident', () => {
    it('releases the services it held, but not ones another open incident still holds', async () => {
      const api = await service('API')
      const web = await service('Website')
      const first = await openIncident([
        { componentId: api, componentStatus: 'major_outage' },
        { componentId: web, componentStatus: 'major_outage' },
      ])
      const second = await openIncident([
        { componentId: api, componentStatus: 'degraded_performance' },
      ])

      await deleteIncident(first.id)
      expect(await statusOf(web)).toBe('operational')
      expect(await statusOf(api)).toBe('degraded_performance')

      await deleteIncident(second.id)
      expect(await statusOf(api)).toBe('operational')
    })
  })

  describe('reopening', () => {
    it('a resolved incident clears resolvedAt, rejoins the open lists and holds its services again', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Fixed.' },
        { principalId: author }
      )
      expect(await statusOf(api)).toBe('operational')
      // Make the first resolution clearly older than any later one.
      await testDb
        .update(statusIncidents)
        .set({ resolvedAt: new Date(Date.now() - 2 * HOUR) })
        .where(eq(statusIncidents.id, incident.id))

      const reopened = await postIncidentUpdate(
        incident.id,
        { status: 'monitoring', body: 'It is back.' },
        { principalId: author }
      )
      expect(reopened.status).toBe('monitoring')
      expect(reopened.resolvedAt).toBeNull()
      expect(await statusOf(api)).toBe('major_outage')
      const open = await listStatusIncidents({ kind: 'incident', state: 'active' })
      expect(open.items.map((i) => i.id)).toEqual([incident.id])
      const snapshot = await getStatusPageSnapshot(ANONYMOUS_ACTOR, { pageDescription: '' })
      expect(snapshot.activeIncidents.map((i) => i.id)).toEqual([incident.id])

      const resolvedAgain = await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Fixed for real.' },
        { principalId: author }
      )
      expect(resolvedAgain.resolvedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000)
      expect(await statusOf(api)).toBe('operational')
    })

    it('a completed window goes back to holding its services and is not re-completed by the sweep', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Upgrade',
          status: 'in_progress',
          body: 'Upgrading.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - 2 * HOUR),
          scheduledEndAt: new Date(Date.now() - HOUR),
          notifySubscribers: false,
        },
        { principalId: author }
      )
      await handleMaintenanceComplete(window.id)
      expect(await statusOf(db)).toBe('operational')

      const reopened = await postIncidentUpdate(
        window.id,
        { status: 'verifying', body: 'Still checking replicas.' },
        { principalId: author }
      )
      expect(reopened.resolvedAt).toBeNull()
      // Its end has passed, so auto-complete would close it again at once.
      expect(reopened.autoComplete).toBe(false)
      expect(await statusOf(db)).toBe('under_maintenance')

      await reconcileMaintenanceWindows()
      expect((await getStatusIncidentById(window.id)).status).toBe('verifying')
    })

    it('a running window moved back to scheduled is not restarted by the sweep', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Upgrade',
          status: 'in_progress',
          body: 'Upgrading.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - HOUR),
          scheduledEndAt: new Date(Date.now() + HOUR),
          notifySubscribers: false,
        },
        { principalId: author }
      )

      const moved = await postIncidentUpdate(
        window.id,
        { status: 'scheduled', body: 'Not yet, rescheduling.' },
        { principalId: author }
      )
      expect(moved.autoStart).toBe(false)
      expect(await statusOf(db)).toBe('operational')

      await reconcileMaintenanceWindows()
      expect((await getStatusIncidentById(window.id)).status).toBe('scheduled')
    })
  })

  describe('maintenance start time', () => {
    it('holds the planned start until the window starts, and follows a reschedule', async () => {
      const start = new Date(Date.now() + 24 * HOUR)
      const window = await scheduleWindow(start, new Date(start.getTime() + HOUR))
      expect(window.startedAt.getTime()).toBe(start.getTime())

      const later = new Date(start.getTime() + 2 * HOUR)
      const moved = await updateIncident(window.id, {
        scheduledStartAt: later,
        scheduledEndAt: new Date(later.getTime() + HOUR),
      })
      expect(moved.startedAt.getTime()).toBe(later.getTime())
    })

    it('records the real start when the scheduler starts the window', async () => {
      const window = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      await handleMaintenanceStart(window.id)
      const started = await getStatusIncidentById(window.id)
      expect(started.status).toBe('in_progress')
      expect(isRecent(started.startedAt)).toBe(true)
    })

    it('records the real start on "Start now" and on a posted in-progress update', async () => {
      const early = await scheduleWindow(new Date(Date.now() + 24 * HOUR), null)
      await startMaintenanceNow(early.id)
      expect(isRecent((await getStatusIncidentById(early.id)).startedAt)).toBe(true)

      const posted = await scheduleWindow(new Date(Date.now() + 24 * HOUR), null)
      const after = await postIncidentUpdate(
        posted.id,
        { status: 'in_progress', body: 'Starting early.' },
        { principalId: author }
      )
      expect(isRecent(after.startedAt)).toBe(true)
    })

    it('rejects a window that ends before it starts, on create and on update', async () => {
      const start = new Date(Date.now() + 24 * HOUR)
      await expect(scheduleWindow(start, new Date(start.getTime() - HOUR))).rejects.toBeInstanceOf(
        ValidationError
      )

      const window = await scheduleWindow(start, new Date(start.getTime() + HOUR))
      await expect(
        updateIncident(window.id, { scheduledEndAt: new Date(start.getTime() - HOUR) })
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        updateIncident(window.id, { scheduledStartAt: new Date(start.getTime() + 2 * HOUR) })
      ).rejects.toBeInstanceOf(ValidationError)
    })

    it('migration 0298 dates existing windows by their start, and a second run changes nothing', async () => {
      const day = 24 * HOUR
      const now = Date.now()
      const rows = {
        upcoming: { created: now - day, start: now + day },
        started: { created: now - 3 * day, start: now - 2 * day },
        createdUnderWay: { created: now - HOUR, start: now - 2 * HOUR },
      }
      const ids: Record<string, string> = {}
      for (const [name, row] of Object.entries(rows)) {
        const [inserted] = await testDb
          .insert(statusIncidents)
          .values({
            kind: 'maintenance',
            title: name,
            status: 'scheduled',
            impact: 'maintenance',
            scheduledStartAt: new Date(row.start),
            startedAt: new Date(row.created),
          })
          .returning({ id: statusIncidents.id })
        ids[name] = inserted.id
      }
      const [incident] = await testDb
        .insert(statusIncidents)
        .values({
          kind: 'incident',
          title: 'incident',
          status: 'investigating',
          scheduledStartAt: new Date(now + day),
          startedAt: new Date(now - day),
        })
        .returning({ id: statusIncidents.id })

      const migration = readFileSync(
        resolve(process.cwd(), 'packages/db/drizzle/0298_status_maintenance_started_at.sql'),
        'utf8'
      )
      await testDb.execute(sql.raw(migration))
      await testDb.execute(sql.raw(migration))

      const startedAt = async (id: string) =>
        (await testDb.query.statusIncidents.findFirst({
          where: eq(statusIncidents.id, id as never),
        }))!.startedAt.getTime()
      expect(await startedAt(ids.upcoming)).toBe(rows.upcoming.start)
      expect(await startedAt(ids.started)).toBe(rows.started.start)
      expect(await startedAt(ids.createdUnderWay)).toBe(rows.createdUnderWay.created)
      expect(await startedAt(incident.id)).toBe(now - day)
    })
  })

  describe('publishing with "Email subscribers" off', () => {
    it('records no send, and neither the claim nor the sweep sends one later', async () => {
      const api = await service('API')
      const quiet = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      expect(quiet.notifySubscribers).toBe(false)
      expect(quiet.notifiedAt).toBeNull()

      const actor = { type: 'service' as const, displayName: 'test' }
      expect(await notifyStatusIncidentPublished(quiet.id, actor)).toBe(false)

      // A row that asked for the email and was never claimed (the process
      // died before the fire-and-forget send) is still picked up.
      const [pending] = await testDb
        .insert(statusIncidents)
        .values({ kind: 'incident', title: 'Pending', status: 'investigating' })
        .returning({ id: statusIncidents.id })
      expect(await reconcileStatusNotifications()).toBe(1)

      expect((await getStatusIncidentById(quiet.id)).notifiedAt).toBeNull()
      expect((await getStatusIncidentById(pending.id)).notifiedAt).not.toBeNull()
      const published = mockProcessEvent.mock.calls.filter(
        ([event]) => (event as { type: string }).type === 'status.incident_created'
      )
      expect(published).toHaveLength(1)
    })
  })
})
