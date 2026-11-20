/**
 * Incident and maintenance lifecycle against real Postgres: the paths whose
 * correctness depends on the SQL (the reconcile query's active set, the
 * soft-delete filters, transaction rollback) rather than on call order.
 * When a maintenance window is dated as started, and the scheduler's
 * transitions, are in status.maintenance-timing.db.test.ts.
 *
 * Event dispatch and the delayed-job scheduler are stubbed; everything else
 * runs for real inside the fixture's always-rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  events,
  isNull,
  statusComponentEvents,
  statusIncidentComponents,
  statusIncidents,
} from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { cancelScheduledDispatch } from '@/lib/server/events/scheduler'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockProcessEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/events/process', () => ({
  processEvent: (...args: unknown[]) => mockProcessEvent(...args),
}))

// A quiet publication writes its event on the create transaction; this lets a
// test make that write fail.
const outbox = vi.hoisted(() => ({ fail: false, failNext: 0, okFirst: 0 }))
vi.mock('@/lib/server/events/outbox-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/events/outbox-dispatch')>()
  return {
    ...actual,
    writeEventToOutbox: async (...args: Parameters<typeof actual.writeEventToOutbox>) => {
      if (outbox.okFirst-- > 0) return actual.writeEventToOutbox(...args)
      if (outbox.fail || outbox.failNext-- > 0) throw new Error('outbox unavailable')
      return actual.writeEventToOutbox(...args)
    },
  }
})

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))

import { deleteStatusComponent, setComponentStatus } from '../status.components'
import {
  createIncident,
  createStatusIncidentTemplate,
  deleteIncident,
  findStatusIncidentById,
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
import {
  HOUR,
  author,
  beginTest,
  fixture,
  isRecent,
  openIncident,
  raceOnStaleRead,
  scheduleWindow,
  service,
  statusOf,
} from './status-lifecycle-harness'

describe('status lifecycle (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    mockProcessEvent.mockReset().mockResolvedValue(undefined)
    outbox.fail = false
    outbox.failNext = 0
    outbox.okFirst = 0
    await beginTest()
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

    it('tells a stale editor whose every service was deleted that, not that none was chosen', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      await deleteStatusComponent(api)

      await expect(
        updateIncident(incident.id, {
          title: 'Elevated errors',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
        })
      ).rejects.toThrow('An affected service has been deleted. Choose the services again.')
    })

    it('tells an editor naming a service that never existed so, not that it was deleted', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])

      await expect(
        updateIncident(incident.id, {
          title: 'Elevated errors',
          affectedComponents: [
            { componentId: api, componentStatus: 'major_outage' },
            { componentId: createId('status_component'), componentStatus: 'major_outage' },
          ],
        })
      ).rejects.toThrow('An affected service does not exist.')
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

      const attempt = createIncident(
        {
          kind: 'incident',
          title: 'Errors',
          status: 'investigating',
          body: 'Looking into it.',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
        },
        { principalId: author }
      )
      await expect(attempt).rejects.toBeInstanceOf(ValidationError)
      // Worded for API callers as well as the dashboard: no "refresh the page".
      await expect(attempt).rejects.toThrow(
        'An affected service has been deleted. Choose the services again.'
      )
      expect(await testDb.query.statusIncidents.findMany()).toEqual([])
    })

    it('rejects a service that never existed as unknown, not deleted, and writes nothing', async () => {
      const attempt = createIncident(
        {
          kind: 'incident',
          title: 'Errors',
          status: 'investigating',
          body: 'Looking into it.',
          affectedComponents: [
            { componentId: createId('status_component'), componentStatus: 'major_outage' },
          ],
        },
        { principalId: author }
      )
      await expect(attempt).rejects.toBeInstanceOf(ValidationError)
      await expect(attempt).rejects.toThrow('An affected service does not exist.')
      expect(await testDb.query.statusIncidents.findMany()).toEqual([])
    })

    it('created already resolved, it is stamped resolved and leaves its services alone', async () => {
      const api = await service('API')
      await setComponentStatus(api, 'degraded_performance', 'manual')

      const resolved = await createIncident(
        {
          kind: 'incident',
          title: 'Blip',
          status: 'resolved',
          body: 'A short blip, already over.',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
          notifySubscribers: false,
        },
        { principalId: author }
      )
      expect(resolved.resolvedAt).not.toBeNull()
      expect(isRecent(resolved.resolvedAt!)).toBe(true)
      expect(resolved.startedAt.getTime()).toBeLessThanOrEqual(resolved.resolvedAt!.getTime())
      // It never held the service, so neither outage nor restore applies.
      expect(await statusOf(api)).toBe('degraded_performance')
      expect((await listStatusIncidents({ kind: 'incident', state: 'active' })).items).toEqual([])
      expect(
        (await listStatusIncidents({ kind: 'incident', state: 'resolved' })).items.map((i) => i.id)
      ).toEqual([resolved.id])
    })

    it('a window created already completed is stamped resolved, dated by its plan, and holds nothing', async () => {
      const db = await service('Database')
      const plan = new Date(Date.now() - 3 * HOUR)
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Upgrade',
          status: 'completed',
          body: 'Done last night.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: plan,
          scheduledEndAt: new Date(plan.getTime() + HOUR),
          notifySubscribers: false,
        },
        { principalId: author }
      )
      expect(isRecent(window.resolvedAt!)).toBe(true)
      expect(window.startedAt.getTime()).toBe(plan.getTime())
      expect(await statusOf(db)).toBe('operational')
      expect(await reconcileMaintenanceWindows()).toEqual({ started: 0, completed: 0 })
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
    it('decides from the row as deleted, not as first read', async () => {
      const window = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      const [link] = window.affectedComponents

      // Read while still scheduled; the scheduler starts it before the
      // delete lands, so the delete must release what it now holds.
      await raceOnStaleRead(
        () => deleteIncident(window.id),
        () => handleMaintenanceStart(window.id)
      )
      expect(await statusOf(link.componentId)).toBe('operational')
    })

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

    it('leaves services alone when the row was not holding them', async () => {
      const start = new Date(Date.now() + 24 * HOUR)
      const window = await scheduleWindow(start, new Date(start.getTime() + HOUR))
      const [link] = window.affectedComponents
      await setComponentStatus(link.componentId, 'degraded_performance', 'manual')

      await deleteIncident(window.id)
      expect(await statusOf(link.componentId)).toBe('degraded_performance')

      const api = await service('API')
      const resolved = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      await postIncidentUpdate(
        resolved.id,
        { status: 'resolved', body: 'Fixed.' },
        { principalId: author }
      )
      await setComponentStatus(api, 'partial_outage', 'api')

      await deleteIncident(resolved.id)
      expect(await statusOf(api)).toBe('partial_outage')
    })

    it('reads back as missing (null) for the editor, not as an error', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      expect((await findStatusIncidentById(incident.id))?.id).toBe(incident.id)

      await deleteIncident(incident.id)
      expect(await findStatusIncidentById(incident.id)).toBeNull()
      expect(await findStatusIncidentById(createId('status_incident'))).toBeNull()
    })
  })

  describe('a row that is not holding its services', () => {
    it('leaves a status set since alone when its details are saved', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Fixed.' },
        { principalId: author }
      )
      await setComponentStatus(api, 'degraded_performance', 'manual')

      // The editor's autosave always sends the services back.
      await updateIncident(incident.id, {
        title: 'Elevated errors on the API',
        affectedComponents: [{ componentId: api, componentStatus: 'partial_outage' }],
      })
      expect(await statusOf(api)).toBe('degraded_performance')
    })

    it('leaves it alone when a terminal update is posted', async () => {
      const start = new Date(Date.now() + 24 * HOUR)
      const window = await scheduleWindow(start, new Date(start.getTime() + HOUR))
      const [link] = window.affectedComponents
      await setComponentStatus(link.componentId, 'degraded_performance', 'api')

      // Called off before it ever started.
      await postIncidentUpdate(
        window.id,
        { status: 'completed', body: 'Called off.' },
        { principalId: author }
      )
      expect(await statusOf(link.componentId)).toBe('degraded_performance')

      // A further note on a resolved incident.
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Fixed.' },
        { principalId: author }
      )
      await setComponentStatus(api, 'partial_outage', 'manual')
      await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Root cause: a bad deploy.' },
        { principalId: author }
      )
      expect(await statusOf(api)).toBe('partial_outage')
    })

    it('leaves it alone when the scheduler completes a window that never started', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() - 2 * HOUR),
        new Date(Date.now() - HOUR)
      )
      await updateIncident(window.id, { autoStart: false })
      const [link] = window.affectedComponents
      await setComponentStatus(link.componentId, 'degraded_performance', 'api')

      await handleMaintenanceComplete(window.id)
      expect((await getStatusIncidentById(window.id)).status).toBe('completed')
      expect(await statusOf(link.componentId)).toBe('degraded_performance')
    })

    it('still recomputes a holding row whose services change', async () => {
      const api = await service('API')
      const web = await service('Website')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])

      await updateIncident(incident.id, {
        affectedComponents: [{ componentId: web, componentStatus: 'partial_outage' }],
      })
      expect(await statusOf(api)).toBe('operational')
      expect(await statusOf(web)).toBe('partial_outage')
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

  describe('publishing with "Email subscribers" off', () => {
    it('is never sent, by this version or by an older one rolled back to', async () => {
      const api = await service('API')
      const quiet = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      expect(quiet.notifySubscribers).toBe(false)

      const actor = { type: 'service' as const, displayName: 'test' }
      expect(await notifyStatusIncidentPublished(quiet.id, actor)).toBe(false)

      // A row that asked for the email and was never claimed (the process
      // died before the fire-and-forget send) is still picked up.
      const [pending] = await testDb
        .insert(statusIncidents)
        .values({
          kind: 'incident',
          title: 'Pending',
          status: 'investigating',
          createdAt: new Date(Date.now() - HOUR),
        })
        .returning({ id: statusIncidents.id })
      expect(await reconcileStatusNotifications()).toBe(1)
      expect((await getStatusIncidentById(pending.id)).notifiedAt).not.toBeNull()
      // Only the row that asked for the email is announced to subscribers; the
      // quiet one's event is flagged so the fan-out sends it no email.
      const published = (
        await testDb
          .select({ payload: events.payload })
          .from(events)
          .where(eq(events.type, 'status.incident_created'))
      ).filter(
        (row) =>
          (row.payload as { incident: { notifySubscribers?: boolean } }).incident
            .notifySubscribers !== false
      )
      expect(published).toHaveLength(1)

      // A version without notify_subscribers sweeps every live row with no
      // notified_at. Rolled back to, or as an old worker mid-deploy, it must
      // still find nothing here to announce.
      const releasedSweep = await testDb
        .select({ id: statusIncidents.id })
        .from(statusIncidents)
        .where(
          and(
            isNull(statusIncidents.notifiedAt),
            eq(statusIncidents.backfilled, false),
            isNull(statusIncidents.deletedAt)
          )
        )
      expect(releasedSweep).toEqual([])
    })

    it('still sends the creation event, once, flagged as not emailed', async () => {
      const api = await service('API')
      const quiet = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      const window = await scheduleWindow(
        new Date(Date.now() + HOUR),
        new Date(Date.now() + 2 * HOUR)
      )

      const actor = { type: 'service' as const, displayName: 'test' }
      expect(await notifyStatusIncidentPublished(quiet.id, actor)).toBe(false)
      expect(await reconcileStatusNotifications()).toBe(0)

      // Nothing goes through the after-commit path; the events are in the
      // outbox, written with the rows themselves.
      expect(mockProcessEvent).not.toHaveBeenCalled()
      const sent = async (type: string, entityId: string) =>
        (
          await testDb
            .select({ payload: events.payload })
            .from(events)
            .where(and(eq(events.type, type), eq(events.entityId, entityId)))
        ).map((row) => (row.payload as { incident: Record<string, unknown> }).incident)
      const created = await sent('status.incident_created', quiet.id)
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({ id: quiet.id, notifySubscribers: false })
      const scheduled = await sent('status.maintenance_scheduled', window.id)
      expect(scheduled).toHaveLength(1)
      expect(scheduled[0]).toMatchObject({ id: window.id, notifySubscribers: false })
    })

    it('creates nothing when its creation event cannot be written', async () => {
      const api = await service('API')
      outbox.fail = true
      await expect(
        createIncident(
          {
            kind: 'incident',
            title: 'Quiet and unrecorded',
            status: 'investigating',
            body: 'Looking into it.',
            affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
            notifySubscribers: false,
          },
          { principalId: author }
        )
      ).rejects.toThrow('outbox unavailable')
      const rows = await testDb
        .select({ id: statusIncidents.id })
        .from(statusIncidents)
        .where(eq(statusIncidents.title, 'Quiet and unrecorded'))
      expect(rows).toEqual([])
      expect(await statusOf(api)).toBe('operational')
    })

    it('the sweep leaves a row just published to its own claim', async () => {
      // An older version publishing with the box unchecked inserts the row
      // (notify_subscribers defaulting to true) and stamps notified_at a
      // moment later. The sweep must not send in between.
      const unclaimed = (title: string, createdAt: Date) =>
        testDb
          .insert(statusIncidents)
          .values({ kind: 'incident', title, status: 'investigating', createdAt })
          .returning({ id: statusIncidents.id })
      const [justNow] = await unclaimed('Just published', new Date())
      const [lost] = await unclaimed('Claim lost', new Date(Date.now() - 3 * 60_000))

      expect(await reconcileStatusNotifications()).toBe(1)
      expect((await getStatusIncidentById(justNow.id)).notifiedAt).toBeNull()
      expect((await getStatusIncidentById(lost.id)).notifiedAt).not.toBeNull()
    })
  })

  describe('status events written with the change', () => {
    // Every status event is written to the outbox on the transaction that
    // makes the change, so nothing goes through the after-commit path.
    const sent = async (type: string, entityId: string) =>
      (
        await testDb
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.type, type), eq(events.entityId, entityId)))
      ).length
    const statusOfRow = async (id: string) =>
      (await testDb.query.statusIncidents.findFirst({ where: eq(statusIncidents.id, id as never) }))
        ?.status

    it('a manual start writes the started event once, and the scheduler adds none', async () => {
      const window = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      await postIncidentUpdate(
        window.id,
        { status: 'in_progress', body: 'Starting.' },
        { principalId: author }
      )
      await handleMaintenanceStart(window.id)
      expect(await sent('status.maintenance_started', window.id)).toBe(1)
      expect(await sent('status.maintenance_completed', window.id)).toBe(0)
      expect(await sent('status.incident_updated', window.id)).toBe(1)
      expect(mockProcessEvent).not.toHaveBeenCalled()
    })

    it('a manual completion writes the completed event once, and the scheduler adds none', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() - 2 * HOUR),
        new Date(Date.now() - HOUR)
      )
      await postIncidentUpdate(
        window.id,
        { status: 'completed', body: 'Done.' },
        { principalId: author }
      )
      await handleMaintenanceComplete(window.id)
      expect(await sent('status.maintenance_completed', window.id)).toBe(1)
      expect(await sent('status.maintenance_started', window.id)).toBe(0)
    })

    it('the scheduler completing first leaves a later manual completion silent', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() - 2 * HOUR),
        new Date(Date.now() - HOUR)
      )
      await handleMaintenanceComplete(window.id)
      await postIncidentUpdate(
        window.id,
        { status: 'completed', body: 'Done.' },
        { principalId: author }
      )
      expect(await sent('status.maintenance_completed', window.id)).toBe(1)
    })

    it('the scheduler starting and completing a window writes each event once', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() - 2 * HOUR),
        new Date(Date.now() - HOUR)
      )
      await handleMaintenanceStart(window.id)
      await handleMaintenanceStart(window.id)
      await handleMaintenanceComplete(window.id)
      await handleMaintenanceComplete(window.id)
      expect(await sent('status.maintenance_started', window.id)).toBe(1)
      expect(await sent('status.maintenance_completed', window.id)).toBe(1)
    })

    it('an incident resolved by an update writes no maintenance event', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      await postIncidentUpdate(
        incident.id,
        { status: 'resolved', body: 'Fixed.' },
        { principalId: author }
      )
      expect(await sent('status.incident_updated', incident.id)).toBe(1)
      expect(await sent('status.maintenance_completed', incident.id)).toBe(0)
      expect(await sent('status.maintenance_started', incident.id)).toBe(0)
    })

    it('an update whose event cannot be written does not change the status', async () => {
      const api = await service('API')
      const incident = await openIncident([{ componentId: api, componentStatus: 'major_outage' }])
      outbox.fail = true
      await expect(
        postIncidentUpdate(
          incident.id,
          { status: 'resolved', body: 'Fixed.' },
          { principalId: author }
        )
      ).rejects.toThrow('outbox unavailable')
      expect(await statusOfRow(incident.id)).toBe('investigating')
      expect(await statusOf(api)).toBe('major_outage')
    })

    it('a scheduler start whose event cannot be written leaves the window scheduled', async () => {
      const window = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      outbox.fail = true
      await expect(handleMaintenanceStart(window.id)).rejects.toThrow('outbox unavailable')
      expect(await statusOfRow(window.id)).toBe('scheduled')
      outbox.fail = false
      await handleMaintenanceStart(window.id)
      expect(await statusOfRow(window.id)).toBe('in_progress')
      expect(await sent('status.maintenance_started', window.id)).toBe(1)
    })

    it('a scheduler completion whose event cannot be written leaves the window open', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() - 2 * HOUR),
        new Date(Date.now() - HOUR)
      )
      await handleMaintenanceStart(window.id)
      outbox.fail = true
      await expect(handleMaintenanceComplete(window.id)).rejects.toThrow('outbox unavailable')
      expect(await statusOfRow(window.id)).toBe('in_progress')
      outbox.fail = false
      await handleMaintenanceComplete(window.id)
      expect(await statusOfRow(window.id)).toBe('completed')
      expect(await sent('status.maintenance_completed', window.id)).toBe(1)
    })

    it('a publish claim whose event cannot be written stays unclaimed, then sends once', async () => {
      const [row] = await testDb
        .insert(statusIncidents)
        .values({
          kind: 'incident',
          title: 'Claimed late',
          status: 'investigating',
          createdAt: new Date(Date.now() - HOUR),
        })
        .returning({ id: statusIncidents.id })
      const actor = { type: 'service' as const, displayName: 'test' }
      outbox.fail = true
      expect(await notifyStatusIncidentPublished(row.id, actor)).toBe(false)
      expect((await getStatusIncidentById(row.id)).notifiedAt).toBeNull()
      expect(await sent('status.incident_created', row.id)).toBe(0)
      outbox.fail = false
      expect(await notifyStatusIncidentPublished(row.id, actor)).toBe(true)
      expect(await notifyStatusIncidentPublished(row.id, actor)).toBe(false)
      expect(await sent('status.incident_created', row.id)).toBe(1)
    })

    it('a window created already in progress writes scheduled and started, and the scheduler adds no start', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Under way',
          status: 'in_progress',
          body: 'Already running.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - HOUR),
          scheduledEndAt: new Date(Date.now() + HOUR),
          notifySubscribers: false,
        },
        { principalId: author }
      )
      await handleMaintenanceStart(window.id)
      expect(await sent('status.maintenance_scheduled', window.id)).toBe(1)
      expect(await sent('status.maintenance_started', window.id)).toBe(1)
      expect(await sent('status.maintenance_completed', window.id)).toBe(0)
    })

    it('a manual component status change writes its event with the change, and none for a repeat', async () => {
      const api = await service('API')
      await setComponentStatus(api, 'major_outage', 'manual')
      await setComponentStatus(api, 'major_outage', 'manual')
      const rows = await testDb
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.type, 'status.component_changed'), eq(events.entityId, api)))
      expect(rows.map((r) => r.payload)).toMatchObject([
        {
          componentId: api,
          previousStatus: 'operational',
          status: 'major_outage',
          source: 'manual',
        },
      ])
      expect(mockProcessEvent).not.toHaveBeenCalled()
    })

    it('a component status change whose event cannot be written does not change the status', async () => {
      const api = await service('API')
      outbox.fail = true
      await expect(setComponentStatus(api, 'major_outage', 'api')).rejects.toThrow(
        'outbox unavailable'
      )
      expect(await statusOf(api)).toBe('operational')
      const history = await testDb
        .select({ id: statusComponentEvents.id })
        .from(statusComponentEvents)
        .where(eq(statusComponentEvents.componentId, api))
      expect(history).toEqual([])
    })

    it('the sweep carries on past a window whose event cannot be written', async () => {
      const first = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      const second = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      outbox.failNext = 1
      await expect(reconcileMaintenanceWindows()).resolves.toBeDefined()
      const states = [await statusOfRow(first.id), await statusOfRow(second.id)].sort()
      expect(states).toEqual(['in_progress', 'scheduled'])
    })

    it('start now keeps the start job until the start has succeeded', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() + HOUR),
        new Date(Date.now() + 2 * HOUR)
      )
      vi.mocked(cancelScheduledDispatch).mockClear()
      outbox.fail = true
      await expect(startMaintenanceNow(window.id)).rejects.toThrow('outbox unavailable')
      expect(cancelScheduledDispatch).not.toHaveBeenCalled()
      expect(await statusOfRow(window.id)).toBe('scheduled')
      outbox.fail = false
      await startMaintenanceNow(window.id)
      expect(cancelScheduledDispatch).toHaveBeenCalled()
      expect(await statusOfRow(window.id)).toBe('in_progress')
    })

    it('the completion event carries the title of the row it claimed', async () => {
      const window = await scheduleWindow(
        new Date(Date.now() - 2 * HOUR),
        new Date(Date.now() - HOUR)
      )
      await handleMaintenanceStart(window.id)
      await raceOnStaleRead(
        () => handleMaintenanceComplete(window.id),
        async () => void (await updateIncident(window.id, { title: 'Renamed' }))
      )
      const [completed] = await testDb
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.type, 'status.maintenance_completed'), eq(events.entityId, window.id)))
      expect(completed.payload).toMatchObject({ title: 'Renamed' })
    })

    it('scheduler events carry the title of the row they claimed', async () => {
      const window = await scheduleWindow(new Date(Date.now() - HOUR), new Date(Date.now() + HOUR))
      await raceOnStaleRead(
        () => handleMaintenanceStart(window.id),
        async () => void (await updateIncident(window.id, { title: 'Renamed' }))
      )
      const [started] = await testDb
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.type, 'status.maintenance_started'), eq(events.entityId, window.id)))
      expect(started.payload).toMatchObject({ title: 'Renamed' })
    })

    it('a window whose transition event alone cannot be written is not created', async () => {
      const db = await service('Database')
      // The publish event is written first and succeeds; the transition event
      // fails, and the whole create rolls back with it.
      outbox.okFirst = 1
      outbox.fail = true
      await expect(
        createIncident(
          {
            kind: 'maintenance',
            title: 'Rolled back',
            status: 'in_progress',
            body: 'Already running.',
            affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
            scheduledStartAt: new Date(Date.now() - HOUR),
            scheduledEndAt: new Date(Date.now() + HOUR),
          },
          { principalId: author }
        )
      ).rejects.toThrow('outbox unavailable')
      expect(
        await testDb.select().from(statusIncidents).where(eq(statusIncidents.title, 'Rolled back'))
      ).toEqual([])
      expect(await statusOf(db)).toBe('operational')
      expect(
        await testDb.select().from(events).where(eq(events.type, 'status.maintenance_scheduled'))
      ).toEqual([])
    })

    it('a window created under way with subscriber email on writes scheduled before started', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Emailed and under way',
          status: 'in_progress',
          body: 'Already running.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - HOUR),
          scheduledEndAt: new Date(Date.now() + HOUR),
          notifySubscribers: true,
        },
        { principalId: author }
      )
      // Claimed at create, so the after-commit send and the sweep find
      // nothing left to announce.
      expect((await getStatusIncidentById(window.id)).notifiedAt).not.toBeNull()
      expect(
        await notifyStatusIncidentPublished(window.id, { type: 'service', displayName: 't' })
      ).toBe(false)
      const rows = await testDb
        .select({ id: events.id, type: events.type })
        .from(events)
        .where(eq(events.entityId, window.id))
        .orderBy(events.id)
      expect(rows.map((r) => r.type)).toEqual([
        'status.maintenance_scheduled',
        'status.maintenance_started',
      ])
      const [scheduled] = await testDb
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.type, 'status.maintenance_scheduled'), eq(events.entityId, window.id)))
      expect(scheduled.payload).toMatchObject({
        incident: { id: window.id, notifySubscribers: true },
      })
    })

    // Created already over, it is history, announced like a logged past
    // window: no scheduled or completed event, so no "maintenance scheduled"
    // email for work that is done.
    it('a window created already completed writes no events, and the scheduler adds none', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Done already',
          status: 'completed',
          body: 'It finished.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - 2 * HOUR),
          scheduledEndAt: new Date(Date.now() - HOUR),
          notifySubscribers: false,
        },
        { principalId: author }
      )
      await handleMaintenanceStart(window.id)
      await handleMaintenanceComplete(window.id)
      expect(await sent('status.maintenance_scheduled', window.id)).toBe(0)
      expect(await sent('status.maintenance_completed', window.id)).toBe(0)
      expect(await sent('status.maintenance_started', window.id)).toBe(0)
    })

    it('a window logged as past history writes no transition events', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Logged',
          status: 'completed',
          body: 'Happened last week.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - 48 * HOUR),
          scheduledEndAt: new Date(Date.now() - 47 * HOUR),
          backfill: {
            startedAt: new Date(Date.now() - 48 * HOUR),
            resolvedAt: new Date(Date.now() - 47 * HOUR),
          },
        },
        { principalId: author }
      )
      expect(await sent('status.maintenance_completed', window.id)).toBe(0)
      expect(await sent('status.maintenance_scheduled', window.id)).toBe(0)
    })
  })

  describe('logging a past incident', () => {
    it('rejects one resolved before it started', async () => {
      const api = await service('API')
      const start = new Date(Date.now() - 2 * HOUR)
      await expect(
        createIncident(
          {
            kind: 'incident',
            title: 'Old outage',
            status: 'resolved',
            body: 'It happened.',
            affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
            backfill: { startedAt: start, resolvedAt: new Date(start.getTime() - HOUR) },
          },
          { principalId: author }
        )
      ).rejects.toBeInstanceOf(ValidationError)
    })

    it('adds history without touching uptime or service status', async () => {
      const api = await service('API')
      const start = new Date(Date.now() - 3 * HOUR)
      const logged = await createIncident(
        {
          kind: 'incident',
          title: 'Old outage',
          status: 'resolved',
          body: 'It happened.',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
          backfill: { startedAt: start, resolvedAt: new Date(start.getTime() + HOUR) },
        },
        { principalId: author }
      )

      expect(logged.backfilled).toBe(true)
      expect(logged.startedAt.getTime()).toBe(start.getTime())
      // Its summary is dated at the resolution, not at the moment it was logged.
      expect(logged.updates.map((u) => u.createdAt.getTime())).toEqual([start.getTime() + HOUR])
      expect(await statusOf(api)).toBe('operational')
      // Uptime bars derive from this log; a backfill writes nothing to it.
      expect(
        await testDb.query.statusComponentEvents.findMany({
          where: eq(statusComponentEvents.componentId, api),
        })
      ).toEqual([])
    })

    it('stays history: it is never live, on create or by a later update', async () => {
      const api = await service('API')
      const start = new Date(Date.now() - 3 * HOUR)
      const backfill = { startedAt: start, resolvedAt: new Date(start.getTime() + HOUR) }
      const past = {
        kind: 'incident' as const,
        title: 'Old outage',
        body: 'It happened.',
        affectedComponents: [{ componentId: api, componentStatus: 'major_outage' as const }],
        backfill,
      }

      await expect(
        createIncident({ ...past, status: 'investigating' }, { principalId: author })
      ).rejects.toThrow('A past incident is logged as resolved. Use the "resolved" status.')

      const logged = await createIncident({ ...past, status: 'resolved' }, { principalId: author })
      await expect(
        postIncidentUpdate(
          logged.id,
          { status: 'monitoring', body: 'It is back.' },
          { principalId: author }
        )
      ).rejects.toThrow("A logged past incident can't be reopened. Report a new incident instead.")

      const after = await getStatusIncidentById(logged.id)
      expect(after.status).toBe('resolved')
      expect(after.resolvedAt?.getTime()).toBe(backfill.resolvedAt.getTime())
      expect(after.updates).toHaveLength(1)
      expect(await statusOf(api)).toBe('operational')
      expect((await listStatusIncidents({ kind: 'incident', state: 'active' })).items).toEqual([])

      // A note on it, still resolved, is fine.
      const noted = await postIncidentUpdate(
        logged.id,
        { status: 'resolved', body: 'Root cause: an expired certificate.' },
        { principalId: author }
      )
      expect(noted.updates).toHaveLength(2)
      expect(noted.resolvedAt?.getTime()).toBe(backfill.resolvedAt.getTime())
    })
  })
})
