/**
 * Status page integrity against real Postgres: writes that must record what
 * they did (a service created already down, history cleared while incidents
 * still hold services), creates that must be refused (a window with no dates,
 * an incident pinned to the maintenance impact, a blank template name),
 * creates that must stay quiet (an incident or window created already over),
 * and reads that must hold still (subscriber paging, a listed incident
 * deleted mid-read, the order of an incident's services).
 *
 * Event dispatch and the delayed-job scheduler are stubbed; everything else
 * runs for real inside the fixture's always-rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type StatusComponentId } from '@quackback/ids'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  events,
  principal,
  sql,
  statusComponentEvents,
  statusComponents,
  statusIncidents,
  statusSubscriptions,
  user,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/process', () => ({ processEvent: vi.fn() }))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))

import { createStatusComponent, reorderStatusComponents } from '../status.components'
import {
  clearStatusHistory,
  createIncident,
  createStatusIncidentTemplate,
  findStatusIncidentById,
  listStatusIncidents,
  postIncidentUpdate,
  reconcileStatusNotifications,
  updateIncident,
  updateStatusIncidentTemplate,
} from '../status.service'
import { listStatusSubscriptions } from '../status.subscription'
import { getComponentLinksForIncidents } from '../status.projection'
import {
  assertSubscribableComponents,
  getVisitorTopLevelStatus,
  viewableStatusComponentIds,
} from '../status.public'
import { getStatusSubscriberTargets } from '@/lib/server/events/targets'
import type { EventData } from '@/lib/server/events/types'
import type { HookContext } from '@/lib/server/events/hook-context'
import { HOUR, author, beginTest, fixture, service, statusOf } from './status-lifecycle-harness'

async function eventsFor(entityId: string) {
  return testDb
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(eq(events.entityId, entityId))
}

async function historyOf(id: StatusComponentId) {
  return testDb
    .select({ status: statusComponentEvents.status, source: statusComponentEvents.source })
    .from(statusComponentEvents)
    .where(eq(statusComponentEvents.componentId, id))
    .orderBy(statusComponentEvents.createdAt)
}

describe('status integrity (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await beginTest()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  /** The subscriber fan-out for each event written for `entityId`. */
  async function subscriberTargetsFor(entityId: string) {
    const rows = await eventsFor(entityId)
    return Promise.all(
      rows.map((r) =>
        getStatusSubscriberTargets(
          { type: r.type, data: r.payload } as unknown as EventData,
          {} as HookContext
        )
      )
    )
  }

  describe('a create that is already over emails nobody', () => {
    it('an incident created resolved keeps its event, flagged quiet, and is never swept', async () => {
      const api = await service('API')
      const incident = await createIncident(
        {
          kind: 'incident',
          title: 'Blip',
          status: 'resolved',
          body: 'Already over.',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
          notifySubscribers: true,
        },
        { principalId: author }
      )
      const evts = await eventsFor(incident.id)
      expect(evts.map((e) => e.type)).toEqual(['status.incident_created'])
      expect(evts[0].payload).toMatchObject({ incident: { notifySubscribers: false } })
      expect(await subscriberTargetsFor(incident.id)).toEqual([[]])
      expect(incident.notifySubscribers).toBe(false)
      await testDb
        .update(statusIncidents)
        .set({ createdAt: new Date(Date.now() - HOUR), notifiedAt: null })
        .where(eq(statusIncidents.id, incident.id))
      expect(await reconcileStatusNotifications()).toBe(0)
      expect(await eventsFor(incident.id)).toHaveLength(1)
      expect(await statusOf(api)).toBe('operational')
    })

    it('a window created completed keeps its events, flagged quiet', async () => {
      const db = await service('Database')
      const window = await createIncident(
        {
          kind: 'maintenance',
          title: 'Done',
          status: 'completed',
          body: 'It finished.',
          affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
          scheduledStartAt: new Date(Date.now() - 2 * HOUR),
          scheduledEndAt: new Date(Date.now() - HOUR),
        },
        { principalId: author }
      )
      expect((await eventsFor(window.id)).map((e) => e.type).sort()).toEqual([
        'status.maintenance_completed',
        'status.maintenance_scheduled',
      ])
      expect(await subscriberTargetsFor(window.id)).toEqual([[], []])
      expect(window.notifySubscribers).toBe(false)
    })

    it('a live incident is still announced', async () => {
      const api = await service('API')
      const incident = await createIncident(
        {
          kind: 'incident',
          title: 'Errors',
          status: 'investigating',
          body: 'Looking.',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
        },
        { principalId: author }
      )
      expect((await eventsFor(incident.id)).map((e) => e.type)).toEqual(['status.incident_created'])
    })
  })

  it('a malformed incident id reads as not found', async () => {
    expect(await findStatusIncidentById('not-an-id' as never)).toBeNull()
  })

  describe('a scheduled maintenance window needs both dates', () => {
    const window =
      (
        start: Date | null,
        end: Date | null,
        status: 'scheduled' | 'in_progress' | 'completed' = 'scheduled'
      ) =>
      async () => {
        const db = await service('Database')
        return createIncident(
          {
            kind: 'maintenance',
            title: 'Upgrade',
            status,
            body: 'Planned.',
            affectedComponents: [{ componentId: db, componentStatus: 'under_maintenance' }],
            scheduledStartAt: start,
            scheduledEndAt: end,
            notifySubscribers: false,
          },
          { principalId: author }
        )
      }
    it('refuses no dates', async () => {
      await expect(window(null, null)()).rejects.toThrow(/start and end/)
    })
    it('refuses a start with no end', async () => {
      await expect(window(new Date(Date.now() + HOUR), null)()).rejects.toThrow(/start and end/)
    })
    it('accepts both', async () => {
      const w = await window(new Date(Date.now() + HOUR), new Date(Date.now() + 2 * HOUR))()
      expect(w.status).toBe('scheduled')
    })
    it('lets a window already under way leave its end open', async () => {
      const w = await window(null, null, 'in_progress')()
      expect(w.status).toBe('in_progress')
    })
    it('refuses a window created completed with no dates, unless it is a backfill', async () => {
      await expect(window(null, null, 'completed')()).rejects.toThrow(/start and end/)
    })
    it('refuses clearing the end of a scheduled window', async () => {
      const w = await window(new Date(Date.now() + HOUR), new Date(Date.now() + 2 * HOUR))()
      await expect(updateIncident(w.id, { scheduledEndAt: null })).rejects.toThrow(/start and end/)
      await expect(updateIncident(w.id, { scheduledStartAt: null })).rejects.toThrow(
        /start and end/
      )
    })
  })

  describe('an incident is never pinned to the maintenance impact', () => {
    it('on create', async () => {
      const api = await service('API')
      await expect(
        createIncident(
          {
            kind: 'incident',
            title: 'Pinned',
            status: 'investigating',
            body: 'x',
            impact: 'maintenance',
            impactOverride: true,
            affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
            notifySubscribers: false,
          },
          { principalId: author }
        )
      ).rejects.toThrow(/maintenance/)
    })
    it('on edit', async () => {
      const api = await service('API')
      const incident = await createIncident(
        {
          kind: 'incident',
          title: 'Errors',
          status: 'investigating',
          body: 'x',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
          notifySubscribers: false,
        },
        { principalId: author }
      )
      await expect(
        updateIncident(incident.id, { impactOverride: true, impact: 'maintenance' })
      ).rejects.toThrow(/maintenance/)
    })
  })

  describe('a template name is validated as a name', () => {
    it('on create', async () => {
      await expect(
        createStatusIncidentTemplate({ name: '   ', title: 'T', body: 'b' })
      ).rejects.toThrow('Name is required')
    })
    it('on edit', async () => {
      const t = await createStatusIncidentTemplate({ name: 'N', title: 'T', body: 'b' })
      await expect(updateStatusIncidentTemplate(t.id, { name: '' })).rejects.toThrow(
        'Name is required'
      )
    })
  })

  it('lists every subscriber across pages when many share one created_at', async () => {
    const ids: PrincipalId[] = []
    for (let i = 0; i < 25; i++) {
      const userId = createId('user')
      const principalId = createId('principal')
      await testDb
        .insert(user)
        .values({ id: userId, name: `p${i}`, email: `${userId}@example.com` })
      await testDb
        .insert(principal)
        .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
      ids.push(principalId)
    }
    // One statement, the database's clock: every row has the same created_at.
    await testDb.insert(statusSubscriptions).values(
      ids.map((principalId) => ({
        principalId,
        scope: 'page' as const,
        source: 'csv_import' as const,
      }))
    )
    const [{ distinct }] = await testDb
      .select({ distinct: sql<number>`count(distinct created_at)::int` })
      .from(statusSubscriptions)
    expect(distinct).toBe(1)

    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const res = await listStatusSubscriptions({ cursor, limit: 10 })
      seen.push(...res.items.map((r) => r.principalId))
      if (!res.nextCursor) break
      cursor = res.nextCursor
    }
    expect(new Set(seen).size).toBe(25)
    expect(seen).toHaveLength(25)
  })

  describe('a service created already down', () => {
    it('records the status in its history and announces the change', async () => {
      const svc = await createStatusComponent({
        name: 'Born down',
        status: 'major_outage',
        source: 'api',
      })
      expect(await historyOf(svc.id)).toEqual([{ status: 'major_outage', source: 'api' }])
      const evts = await eventsFor(svc.id)
      expect(evts.map((e) => e.type)).toEqual(['status.component_changed'])
      expect(evts[0].payload).toMatchObject({
        componentId: svc.id,
        previousStatus: 'operational',
        status: 'major_outage',
        source: 'api',
      })
    })
    it('an operational one records nothing', async () => {
      const svc = await createStatusComponent({ name: 'Fine' })
      expect(await historyOf(svc.id)).toEqual([])
      expect(await eventsFor(svc.id)).toEqual([])
    })
  })

  it('clear history keeps the event behind a status an open incident holds', async () => {
    const held = await service('Held')
    const done = await service('Done')
    const open = await createIncident(
      {
        kind: 'incident',
        title: 'Open',
        status: 'investigating',
        body: 'x',
        affectedComponents: [{ componentId: held, componentStatus: 'major_outage' }],
        notifySubscribers: false,
      },
      { principalId: author }
    )
    const closed = await createIncident(
      {
        kind: 'incident',
        title: 'Closed',
        status: 'investigating',
        body: 'x',
        affectedComponents: [{ componentId: done, componentStatus: 'major_outage' }],
        notifySubscribers: false,
      },
      { principalId: author }
    )
    await postIncidentUpdate(
      closed.id,
      { status: 'resolved', body: 'fixed' },
      { principalId: author }
    )
    await clearStatusHistory()
    expect(await findStatusIncidentById(closed.id)).toBeNull()
    expect(await findStatusIncidentById(open.id)).not.toBeNull()
    expect((await historyOf(held)).at(-1)?.status).toBe('major_outage')
    expect(await historyOf(done)).toEqual([])
  })

  it('a listed incident deleted mid-read is left out, not thrown on', async () => {
    const api = await service('API')
    const mk = (title: string) =>
      createIncident(
        {
          kind: 'incident',
          title,
          status: 'investigating',
          body: 'x',
          affectedComponents: [{ componentId: api, componentStatus: 'major_outage' }],
          notifySubscribers: false,
        },
        { principalId: author }
      )
    const a = await mk('A')
    const b = await mk('B')
    const read = testDb.query.statusIncidents
    const realFindMany = read.findMany.bind(read)
    const spy = vi.spyOn(read, 'findMany').mockImplementationOnce((async (
      config: Parameters<typeof realFindMany>[0]
    ) => {
      const rows = await realFindMany(config)
      await testDb
        .update(statusIncidents)
        .set({ deletedAt: new Date() })
        .where(eq(statusIncidents.id, a.id))
      return rows
    }) as never)
    try {
      const res = await listStatusIncidents({ kind: 'incident' })
      expect(res.items.map((i) => i.id)).toEqual([b.id])
    } finally {
      spy.mockRestore()
    }
  })

  it("an incident's services come back in page order", async () => {
    const alpha = await service('Alpha')
    const beta = await service('Beta')
    const incident = await createIncident(
      {
        kind: 'incident',
        title: 'Both',
        status: 'investigating',
        body: 'x',
        affectedComponents: [
          { componentId: alpha, componentStatus: 'major_outage' },
          { componentId: beta, componentStatus: 'major_outage' },
        ],
        notifySubscribers: false,
      },
      { principalId: author }
    )
    // Beta is moved above Alpha on the page: page order, not id or link order.
    await reorderStatusComponents([beta, alpha])
    const links = await getComponentLinksForIncidents([incident.id])
    expect(links.map((l) => l.componentId)).toEqual([beta, alpha])
    const detail = await findStatusIncidentById(incident.id)
    expect(detail?.affectedComponents.map((c) => c.componentId)).toEqual([beta, alpha])
  })

  describe('what visitors see', () => {
    it('the top-level status leaves out gated services', async () => {
      await testDb
        .update(statusComponents)
        .set({ status: 'operational' })
        .where(sql`true`)
      await createStatusComponent({
        name: 'Gated',
        status: 'major_outage',
        segmentIds: [createId('segment')],
      })
      expect(await getVisitorTopLevelStatus()).toBe('operational')
      await createStatusComponent({ name: 'Open', status: 'partial_outage' })
      expect(await getVisitorTopLevelStatus()).toBe('partial_outage')
    })

    it('viewable ids drop gated, deleted, unknown and malformed ids', async () => {
      const open = await service('Open')
      const gated = (
        await createStatusComponent({ name: 'Gated', segmentIds: [createId('segment')] })
      ).id
      const unknown = createId('status_component')
      const viewable = await viewableStatusComponentIds(ANONYMOUS_ACTOR, [
        open,
        gated,
        unknown,
        'not-an-id',
      ])
      expect([...viewable]).toEqual([open])
    })

    it('a component subscription must name services the subscriber can see', async () => {
      const open = await service('Open')
      const gated = (
        await createStatusComponent({ name: 'Gated', segmentIds: [createId('segment')] })
      ).id
      for (const ids of [
        [],
        [createId('status_component')],
        ['not-an-id'],
        [gated],
        [open, gated],
      ]) {
        await expect(assertSubscribableComponents(ANONYMOUS_ACTOR, ids)).rejects.toMatchObject({
          code: 'INVALID_STATUS_COMPONENTS',
        })
      }
      expect(await assertSubscribableComponents(ANONYMOUS_ACTOR, [open])).toEqual([open])
    })
  })
})
