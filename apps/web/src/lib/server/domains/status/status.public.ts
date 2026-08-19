/**
 * Viewer-scoped status page reads (Status Product Spec §4, §7). Every query
 * is composed with `statusComponentViewFilter`/`canViewStatusComponent`
 * (policy/status.ts) so a segment-gated component — and any incident whose
 * only affected components are gated — never leaks to a viewer who hasn't
 * passed Layer 2.
 */
import {
  db,
  eq,
  and,
  or,
  inArray,
  isNull,
  isNotNull,
  desc,
  asc,
  lt,
  lte,
  gte,
  statusComponentGroups,
  statusComponents,
  statusComponentEvents,
  statusIncidents,
  statusIncidentUpdates,
  statusIncidentComponents,
} from '@/lib/server/db'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'
import { canViewStatusComponent, statusComponentViewFilter } from '@/lib/server/policy/status'
import type { Actor } from '@/lib/server/policy/types'
import type { StatusSettings } from '@/lib/shared/status-settings'
import { deriveTopLevelStatus, deriveUptimeDays } from './status.calc'
import type {
  StatusPageSnapshot,
  PublicStatusComponent,
  PublicStatusComponentGroup,
  PublicStatusIncident,
  StatusDayGroup,
  UptimeSeries,
  IncidentHistoryParams,
  IncidentHistoryResult,
} from './status.types'

const RECENT_INCIDENTS_WINDOW_DAYS = 14
const DEFAULT_UPTIME_WINDOW_DAYS = 90

type IncidentRow = typeof statusIncidents.$inferSelect
type ComponentLinkRow = {
  incidentId: StatusIncidentId
  componentId: StatusComponentId
  componentStatus: (typeof statusIncidentComponents.$inferSelect)['componentStatus']
  name: string
  segmentIds: string[]
}

/**
 * Project an incident to its public shape for `actor`, filtering the
 * affected-components list to what they can see. Returns null when the
 * incident has zero visible affected components — the incident itself must
 * then be invisible (Status Product Spec §4).
 */
async function toPublicIncident(
  incident: IncidentRow,
  links: ComponentLinkRow[],
  actor: Actor
): Promise<PublicStatusIncident | null> {
  const visibleLinks = links.filter((l) =>
    canViewStatusComponent(actor, { segmentIds: l.segmentIds })
  )
  if (visibleLinks.length === 0) return null

  const updates = await db.query.statusIncidentUpdates.findMany({
    where: eq(statusIncidentUpdates.incidentId, incident.id),
    orderBy: [asc(statusIncidentUpdates.createdAt)],
  })

  return {
    id: incident.id,
    kind: incident.kind,
    title: incident.title,
    status: incident.status,
    impact: incident.impact,
    scheduledStartAt: incident.scheduledStartAt,
    scheduledEndAt: incident.scheduledEndAt,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    affectedComponents: visibleLinks.map((l) => ({
      id: l.componentId,
      name: l.name,
      componentStatus: l.componentStatus,
    })),
    updates: updates.map((u) => ({
      id: u.id,
      status: u.status,
      body: u.body,
      createdAt: u.createdAt,
    })),
  }
}

/** Fetch the affected-component links (with component name/segmentIds) for a set of incidents. */
async function getComponentLinksForIncidents(
  incidentIds: StatusIncidentId[]
): Promise<ComponentLinkRow[]> {
  if (incidentIds.length === 0) return []
  return db
    .select({
      incidentId: statusIncidentComponents.incidentId,
      componentId: statusIncidentComponents.componentId,
      componentStatus: statusIncidentComponents.componentStatus,
      name: statusComponents.name,
      segmentIds: statusComponents.segmentIds,
    })
    .from(statusIncidentComponents)
    .innerJoin(statusComponents, eq(statusIncidentComponents.componentId, statusComponents.id))
    .where(inArray(statusIncidentComponents.incidentId, incidentIds))
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function getStatusPageSnapshot(
  actor: Actor,
  settings: Pick<StatusSettings, 'pageDescription'>
): Promise<StatusPageSnapshot> {
  void settings // reserved: pageDescription is surfaced by the server-fn layer alongside this snapshot

  const now = new Date()

  const visibleComponentRows = await db
    .select()
    .from(statusComponents)
    .where(and(isNull(statusComponents.deletedAt), statusComponentViewFilter(actor)))
    .orderBy(asc(statusComponents.position))

  const groupIds = [
    ...new Set(
      visibleComponentRows
        .map((c) => c.groupId)
        .filter((id): id is NonNullable<typeof id> => id != null)
    ),
  ]
  const groupRows = groupIds.length
    ? await db.query.statusComponentGroups.findMany({
        where: inArray(statusComponentGroups.id, groupIds),
        orderBy: [asc(statusComponentGroups.position)],
      })
    : []

  const toPublicComponent = (c: (typeof visibleComponentRows)[number]): PublicStatusComponent => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    showUptime: c.showUptime,
  })

  const componentsByGroup = new Map<string, PublicStatusComponent[]>()
  const ungroupedComponents: PublicStatusComponent[] = []
  for (const c of visibleComponentRows) {
    if (c.groupId) {
      const list = componentsByGroup.get(c.groupId) ?? []
      list.push(toPublicComponent(c))
      componentsByGroup.set(c.groupId, list)
    } else {
      ungroupedComponents.push(toPublicComponent(c))
    }
  }

  const groups: PublicStatusComponentGroup[] = groupRows
    .map((g) => ({
      id: g.id,
      name: g.name,
      collapsed: g.collapsed,
      components: componentsByGroup.get(g.id) ?? [],
    }))
    .filter((g) => g.components.length > 0)

  const topLevelStatus = deriveTopLevelStatus(visibleComponentRows.map((c) => c.status))

  // Currently-active: open incidents, plus maintenance windows in progress
  // (a future 'scheduled' window belongs in upcomingMaintenance, not here).
  const activeRows = await db.query.statusIncidents.findMany({
    where: and(
      isNull(statusIncidents.deletedAt),
      or(
        and(eq(statusIncidents.kind, 'incident'), isNull(statusIncidents.resolvedAt)),
        and(
          eq(statusIncidents.kind, 'maintenance'),
          inArray(statusIncidents.status, ['in_progress', 'verifying'])
        )
      )
    ),
    orderBy: [desc(statusIncidents.startedAt)],
  })
  const activeLinks = await getComponentLinksForIncidents(activeRows.map((r) => r.id))
  const activeLinksByIncident = groupLinksByIncident(activeLinks)
  const activeIncidents = await projectIncidents(activeRows, activeLinksByIncident, actor)

  const upcomingRows = await db.query.statusIncidents.findMany({
    where: and(
      isNull(statusIncidents.deletedAt),
      eq(statusIncidents.kind, 'maintenance'),
      eq(statusIncidents.status, 'scheduled')
    ),
    orderBy: [asc(statusIncidents.scheduledStartAt)],
  })
  const upcomingLinks = await getComponentLinksForIncidents(upcomingRows.map((r) => r.id))
  const upcomingMaintenance = await projectIncidents(
    upcomingRows,
    groupLinksByIncident(upcomingLinks),
    actor
  )

  const recentWindowStart = new Date(
    now.getTime() - RECENT_INCIDENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
  const recentRows = await db.query.statusIncidents.findMany({
    where: and(
      isNull(statusIncidents.deletedAt),
      eq(statusIncidents.kind, 'incident'),
      isNotNull(statusIncidents.resolvedAt),
      gte(statusIncidents.startedAt, recentWindowStart)
    ),
    orderBy: [desc(statusIncidents.startedAt)],
  })
  const recentLinks = await getComponentLinksForIncidents(recentRows.map((r) => r.id))
  const recentIncidents = await projectIncidents(
    recentRows,
    groupLinksByIncident(recentLinks),
    actor
  )
  const recentIncidents_grouped = groupByUtcDay(recentIncidents, (i) => i.startedAt)

  return {
    topLevel: {
      status: topLevelStatus,
      worstComponentStatus: topLevelStatus,
      activeIncidentCount: activeIncidents.length,
    },
    groups,
    ungroupedComponents,
    activeIncidents,
    upcomingMaintenance,
    recentIncidents: recentIncidents_grouped,
  }
}

function groupLinksByIncident(
  links: ComponentLinkRow[]
): Map<StatusIncidentId, ComponentLinkRow[]> {
  const map = new Map<StatusIncidentId, ComponentLinkRow[]>()
  for (const l of links) {
    const list = map.get(l.incidentId) ?? []
    list.push(l)
    map.set(l.incidentId, list)
  }
  return map
}

async function projectIncidents(
  rows: IncidentRow[],
  linksByIncident: Map<StatusIncidentId, ComponentLinkRow[]>,
  actor: Actor
): Promise<PublicStatusIncident[]> {
  const results: PublicStatusIncident[] = []
  for (const row of rows) {
    const projected = await toPublicIncident(row, linksByIncident.get(row.id) ?? [], actor)
    if (projected) results.push(projected)
  }
  return results
}

function groupByUtcDay(
  incidents: PublicStatusIncident[],
  getDate: (i: PublicStatusIncident) => Date
): StatusDayGroup[] {
  const byDay = new Map<string, PublicStatusIncident[]>()
  for (const incident of incidents) {
    const key = utcDayKey(getDate(incident))
    const list = byDay.get(key) ?? []
    list.push(incident)
    byDay.set(key, list)
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, dayIncidents]) => ({ date, incidents: dayIncidents }))
}

/** Returns null when the incident doesn't exist, is deleted, or has zero
 *  affected components visible to `actor` (Status Product Spec §4). */
export async function getPublicStatusIncident(
  actor: Actor,
  id: StatusIncidentId
): Promise<PublicStatusIncident | null> {
  const incident = await db.query.statusIncidents.findFirst({
    where: and(eq(statusIncidents.id, id), isNull(statusIncidents.deletedAt)),
  })
  if (!incident) return null

  const links = await getComponentLinksForIncidents([id])
  return toPublicIncident(incident, links, actor)
}

export async function getUptimeSeries(
  actor: Actor,
  componentIds: StatusComponentId[],
  windowDays: number = DEFAULT_UPTIME_WINDOW_DAYS
): Promise<UptimeSeries[]> {
  if (componentIds.length === 0) return []

  const componentRows = await db
    .select()
    .from(statusComponents)
    .where(and(inArray(statusComponents.id, componentIds), isNull(statusComponents.deletedAt)))

  const visibleComponents = componentRows.filter((c) =>
    canViewStatusComponent(actor, { segmentIds: c.segmentIds })
  )
  if (visibleComponents.length === 0) return []

  const now = new Date()
  const visibleIds = visibleComponents.map((c) => c.id)
  const events = await db.query.statusComponentEvents.findMany({
    where: and(
      inArray(statusComponentEvents.componentId, visibleIds),
      lte(statusComponentEvents.createdAt, now)
    ),
    orderBy: [asc(statusComponentEvents.createdAt)],
  })

  const eventsByComponent = new Map<
    StatusComponentId,
    { status: (typeof events)[number]['status']; createdAt: Date }[]
  >()
  for (const e of events) {
    const list = eventsByComponent.get(e.componentId) ?? []
    list.push({ status: e.status, createdAt: e.createdAt })
    eventsByComponent.set(e.componentId, list)
  }

  return visibleComponents.map((c) => ({
    componentId: c.id,
    // No recorded event before the window start defaults the baseline to
    // 'operational' (the schema's own default), matching a component with
    // no history at all.
    days: deriveUptimeDays(eventsByComponent.get(c.id) ?? [], 'operational', windowDays, now),
  }))
}

export async function listIncidentHistory(
  actor: Actor,
  params: IncidentHistoryParams
): Promise<IncidentHistoryResult> {
  const { cursor, limit = 20 } = params
  const conditions = [isNull(statusIncidents.deletedAt), isNotNull(statusIncidents.resolvedAt)]

  if (cursor) {
    const cursorRow = await db.query.statusIncidents.findFirst({
      where: eq(statusIncidents.id, cursor as StatusIncidentId),
      columns: { startedAt: true },
    })
    if (cursorRow) {
      conditions.push(
        or(
          lt(statusIncidents.startedAt, cursorRow.startedAt),
          and(
            eq(statusIncidents.startedAt, cursorRow.startedAt),
            lt(statusIncidents.id, cursor as StatusIncidentId)
          )
        )!
      )
    }
  }

  // Visibility filtering happens after pagination (per-row, cheap at this
  // volume) — mirrors listPublicChangelogs's category-gate approach, so the
  // cursor stays anchored on the underlying `startedAt` ordering rather than
  // reshuffling around a rare per-viewer gate. A page can come back shorter
  // than `limit` when some rows are fully gated for this viewer; the cursor
  // still advances correctly since it's derived from the last fetched row,
  // not the last visible one.
  const rows = await db.query.statusIncidents.findMany({
    where: and(...conditions),
    orderBy: [desc(statusIncidents.startedAt), desc(statusIncidents.id)],
    limit: limit + 1,
  })

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const links = await getComponentLinksForIncidents(pageRows.map((r) => r.id))
  const items = await projectIncidents(pageRows, groupLinksByIncident(links), actor)

  return {
    items,
    nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
    hasMore,
  }
}
