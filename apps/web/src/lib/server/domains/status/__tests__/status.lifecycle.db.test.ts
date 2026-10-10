/**
 * Incident and maintenance lifecycle against real Postgres: the paths whose
 * correctness depends on the SQL (the reconcile query's active set, the
 * soft-delete filters, transaction rollback) rather than on call order.
 *
 * Event dispatch and the delayed-job scheduler are stubbed; everything else
 * runs for real inside the fixture's always-rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type StatusComponentId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
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

vi.mock('@/lib/server/events/process', () => ({
  processEvent: vi.fn().mockResolvedValue(undefined),
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
  postIncidentUpdate,
  updateIncident,
} from '../status.service'
import { handleMaintenanceComplete, reconcileMaintenanceWindows } from '../status.maintenance'
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

async function statusOf(id: StatusComponentId) {
  const row = await testDb.query.statusComponents.findFirst({
    where: eq(statusComponents.id, id),
  })
  return row?.status
}

describe('status lifecycle (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
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
})
