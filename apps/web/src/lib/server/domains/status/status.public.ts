/**
 * Viewer-scoped status page reads (Status Product Spec §4, §7). Every query
 * is composed with `statusComponentViewFilter`/`canViewStatusComponent`
 * (policy/status.ts) so a segment-gated component — and any incident whose
 * only affected components are gated — never leaks to a viewer who hasn't
 * passed Layer 2. Components the plan hides past its cap after the grace
 * (`planVisibleComponentIds`) are left out the same way.
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
  ne,
  lte,
  gte,
  statusComponentGroups,
  statusComponents,
  statusComponentEvents,
  statusIncidents,
} from '@/lib/server/db'
import { isTypeId, type StatusComponentId, type StatusIncidentId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { canViewStatusComponent, statusComponentViewFilter } from '@/lib/server/policy/status'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import type { StatusSettings } from '@/lib/shared/status-settings'
import { deriveTopLevelStatus, deriveUptimeDays } from './status.calc'
import {
  getComponentLinksForIncidents,
  groupLinksByIncident,
  planVisibleComponentIds,
  projectIncidents,
  toPublicIncident,
  visibleIncidentFilter,
} from './status.projection'
import type {
  StatusComponentStatus,
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

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Where the page's recent window starts: 14 days back, rounded down to the
 * start of that UTC day. The page's history query is keyed on this value and
 * continues from it, so it holds still between refetches (it moves once a
 * day), and the window always covers at least the 14 days the page names.
 */
function recentWindowStartFor(now: Date): Date {
  const start = new Date(now.getTime() - RECENT_INCIDENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

export async function getStatusPageSnapshot(
  actor: Actor,
  settings: Pick<StatusSettings, 'pageDescription'>
): Promise<StatusPageSnapshot> {
  void settings // reserved: pageDescription is surfaced by the server-fn layer alongside this snapshot

  const now = new Date()

  const [viewerComponentRows, planVisible] = await Promise.all([
    db
      .select()
      .from(statusComponents)
      .where(and(isNull(statusComponents.deletedAt), statusComponentViewFilter(actor)))
      .orderBy(asc(statusComponents.position)),
    planVisibleComponentIds(),
  ])
  const visibleComponentRows =
    planVisible === null
      ? viewerComponentRows
      : viewerComponentRows.filter((c) => planVisible.includes(c.id))

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

  const recentWindowStart = recentWindowStartFor(now)
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
    recentWindow: { start: recentWindowStart, days: RECENT_INCIDENTS_WINDOW_DAYS },
  }
}

/**
 * The top-level status an anonymous visitor sees: the public page's own
 * `topLevel.status`, without building the rest of the page. Gated services
 * and those the plan hides don't count.
 */
export async function getVisitorTopLevelStatus(): Promise<StatusComponentStatus> {
  const [rows, planVisible] = await Promise.all([
    db
      .select({ id: statusComponents.id, status: statusComponents.status })
      .from(statusComponents)
      .where(and(isNull(statusComponents.deletedAt), statusComponentViewFilter(ANONYMOUS_ACTOR))),
    planVisibleComponentIds(),
  ])
  return deriveTopLevelStatus(
    rows.filter((c) => planVisible === null || planVisible.includes(c.id)).map((c) => c.status)
  )
}

/**
 * The ids in `ids` that name a live service `actor` can see on the page (the
 * segment gate and the plan's visible services). Ids that aren't service ids
 * are dropped, not queried.
 */
export async function viewableStatusComponentIds(
  actor: Actor,
  ids: readonly string[]
): Promise<Set<StatusComponentId>> {
  const wellFormed = [
    ...new Set(ids.filter((id): id is StatusComponentId => isTypeId(id, 'status_component'))),
  ]
  if (wellFormed.length === 0) return new Set()
  const [rows, planVisible] = await Promise.all([
    db
      .select({ id: statusComponents.id })
      .from(statusComponents)
      .where(
        and(
          inArray(statusComponents.id, wellFormed),
          isNull(statusComponents.deletedAt),
          statusComponentViewFilter(actor)
        )
      ),
    planVisibleComponentIds(),
  ])
  return new Set(
    rows.map((r) => r.id).filter((id) => planVisible === null || planVisible.includes(id))
  )
}

/**
 * The services a self-serve subscription to chosen services names, refused
 * unless there is at least one and every one is a live service the subscriber
 * can see. A list that names nothing they can see would store an active
 * subscription no incident could ever match, which still counts as a
 * subscriber (and takes a plan slot).
 */
export async function assertSubscribableComponents(
  actor: Actor,
  componentIds: readonly string[]
): Promise<StatusComponentId[]> {
  if (componentIds.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Choose at least one service to follow')
  }
  const viewable = await viewableStatusComponentIds(actor, componentIds)
  if (componentIds.some((id) => !viewable.has(id as StatusComponentId))) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'A chosen service is no longer on the status page. Choose the services again.'
    )
  }
  return [...viewable]
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
  // The id comes from the URL. One that isn't an incident id (a mistyped or
  // made-up link) names no incident, and converting it for the query would
  // throw instead of reading as not found.
  if (!isTypeId(id, 'status_incident')) return null
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
  windowDays: number = DEFAULT_UPTIME_WINDOW_DAYS,
  /**
   * `admin`: the admin's own strips, which list every component, including
   * those the plan hides from the public page.
   */
  options: { admin?: boolean } = {}
): Promise<UptimeSeries[]> {
  if (componentIds.length === 0) return []

  const [componentRows, planVisible] = await Promise.all([
    db
      .select()
      .from(statusComponents)
      .where(and(inArray(statusComponents.id, componentIds), isNull(statusComponents.deletedAt))),
    options.admin ? null : planVisibleComponentIds(),
  ])

  const visibleComponents = componentRows.filter(
    (c) =>
      canViewStatusComponent(actor, { segmentIds: c.segmentIds }) &&
      (planVisible === null || planVisible.includes(c.id))
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
  const { cursor, limit = 20, before } = params
  const conditions = [isNull(statusIncidents.deletedAt), isNotNull(statusIncidents.resolvedAt)]

  // The page already lists the resolved incidents that started inside its
  // recent window (`getStatusPageSnapshot`), so history picks up after them.
  // Only incidents are cut: the window never shows maintenance, and a window
  // completed last week would otherwise appear nowhere on the page.
  if (before) {
    conditions.push(
      or(ne(statusIncidents.kind, 'incident'), lt(statusIncidents.startedAt, before))!
    )
  }

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

/** When an incident last changed: its newest update, or its resolution if
 *  that came later. A scheduled window's `startedAt` can lie in the future,
 *  so it is only the fallback for a row with neither. */
export function statusIncidentLastActivityAt(incident: PublicStatusIncident): Date {
  let latest: Date | null = incident.resolvedAt
  for (const update of incident.updates) {
    if (!latest || update.createdAt > latest) latest = update.createdAt
  }
  return latest ?? incident.startedAt
}

/** A feed item: the public incident, and when its details (title, window,
 *  services) were last edited without an update, if ever. */
export interface StatusFeedIncident extends PublicStatusIncident {
  detailsEditedAt: Date | null
}

/**
 * Everything a status feed carries, most recent activity first: every open
 * incident and every window that is scheduled or under way, plus the `limit`
 * resolved incidents and completed windows with the most recent activity. The
 * limit counts only resolved history, so what is happening now is always
 * listed.
 * Visibility is the public page's, so a feed never lists what the page would
 * hide.
 */
export async function listStatusFeedItems(
  actor: Actor,
  limit: number = 50
): Promise<StatusFeedIncident[]> {
  const planVisible = await planVisibleComponentIds()
  const [openRows, resolvedRows] = await Promise.all([
    db.query.statusIncidents.findMany({
      where: and(
        isNull(statusIncidents.deletedAt),
        or(
          and(eq(statusIncidents.kind, 'incident'), isNull(statusIncidents.resolvedAt)),
          and(
            eq(statusIncidents.kind, 'maintenance'),
            inArray(statusIncidents.status, ['scheduled', 'in_progress', 'verifying'])
          )
        )
      ),
    }),
    // The viewer's visibility applies before the limit, so incidents they
    // can't see never take the places of older ones they can. Ordered by when
    // the row was last written (an update, an edit, the resolution), so an
    // older incident updated or edited since still reaches the feed.
    db
      .select()
      .from(statusIncidents)
      .where(
        and(
          isNull(statusIncidents.deletedAt),
          isNotNull(statusIncidents.resolvedAt),
          visibleIncidentFilter(actor, planVisible)
        )
      )
      .orderBy(desc(statusIncidents.updatedAt), desc(statusIncidents.id))
      .limit(limit),
  ])

  // A row can match both reads (a window moved back to "scheduled" before
  // reopening cleared its `resolvedAt`); list it once.
  const seen = new Set<string>()
  const rows = [...openRows, ...resolvedRows].filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
  const links = await getComponentLinksForIncidents(rows.map((r) => r.id))
  const items = await projectIncidents(rows, groupLinksByIncident(links), actor)
  const detailsEditedAt = new Map(rows.map((row) => [row.id, row.detailsEditedAt]))

  return items
    .map((incident) => ({ incident, at: statusIncidentLastActivityAt(incident).getTime() }))
    .sort((a, b) => b.at - a.at)
    .map(({ incident }) => ({
      ...incident,
      detailsEditedAt: detailsEditedAt.get(incident.id) ?? null,
    }))
}
