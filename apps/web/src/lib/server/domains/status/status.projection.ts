/**
 * The public shape of an incident for one viewer, shared by every public
 * status read (the page, an incident, history, the feed). An incident shows
 * only the affected services the viewer can see (`canViewStatusComponent`,
 * policy/status.ts) and the plan shows (`planVisibleComponentIds`), and is
 * hidden entirely when none of them is left (Status Product Spec §4).
 */
import type { SQL } from 'drizzle-orm'
import {
  db,
  eq,
  and,
  asc,
  exists,
  inArray,
  sql,
  statusComponents,
  statusIncidents,
  statusIncidentUpdates,
  statusIncidentComponents,
} from '@/lib/server/db'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'
import { canViewStatusComponent, statusComponentViewFilter } from '@/lib/server/policy/status'
import type { Actor } from '@/lib/server/policy/types'
import { deriveViewerImpact } from './status.calc'
import { visibleStatusComponentIds } from '@/lib/server/domains/plan-limits/plan-limits.service'
import type { PublicStatusIncident } from './status.types'

type IncidentRow = typeof statusIncidents.$inferSelect
type IncidentUpdateRow = typeof statusIncidentUpdates.$inferSelect
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
 * then be invisible (Status Product Spec §4). The impact is the viewer's
 * too (`deriveViewerImpact`): services they can't see don't raise it.
 */
export async function toPublicIncident(
  incident: IncidentRow,
  links: ComponentLinkRow[],
  actor: Actor,
  /** The plan's visible components (see {@link planVisibleComponentIds}); read when omitted. */
  planVisible?: readonly string[] | null,
  /** Pre-fetched timeline updates ordered by createdAt; queried when omitted. */
  prefetchedUpdates?: IncidentUpdateRow[]
): Promise<PublicStatusIncident | null> {
  const shown = planVisible === undefined ? await planVisibleComponentIds() : planVisible
  const visibleLinks = links.filter(
    (l) =>
      canViewStatusComponent(actor, { segmentIds: l.segmentIds }) &&
      (shown === null || shown.includes(l.componentId))
  )
  if (visibleLinks.length === 0) return null

  const updates =
    prefetchedUpdates ??
    (await db.query.statusIncidentUpdates.findMany({
      where: eq(statusIncidentUpdates.incidentId, incident.id),
      orderBy: [asc(statusIncidentUpdates.createdAt)],
    }))

  return {
    id: incident.id,
    kind: incident.kind,
    title: incident.title,
    status: incident.status,
    impact: deriveViewerImpact(
      incident.impact,
      visibleLinks.map((l) => l.componentStatus),
      visibleLinks.length < links.length
    ),
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

/**
 * SQL twin of {@link toPublicIncident}'s rule, for a query over
 * `statusIncidents` that must count only incidents the viewer can see (before
 * a limit, say): the incident has an affected service the viewer can see.
 * Same links, same gate, so it never admits a row the projection would hide.
 * For core `select` queries only: the relational builder would rewrite these
 * column references onto its own alias.
 */
export function visibleIncidentFilter(actor: Actor, planVisible: readonly string[] | null): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(statusIncidentComponents)
      .innerJoin(statusComponents, eq(statusIncidentComponents.componentId, statusComponents.id))
      .where(
        and(
          eq(statusIncidentComponents.incidentId, statusIncidents.id),
          statusComponentViewFilter(actor),
          planVisible === null
            ? undefined
            : planVisible.length > 0
              ? inArray(statusComponents.id, planVisible as StatusComponentId[])
              : sql`false`
        )
      )
  )
}

/**
 * The components the plan lets the public page show, or null for all of them.
 * Past the plan's status component cap after the grace, the rest are hidden
 * from every public read, exactly as a component the viewer may not see is,
 * and stay in the admin. Fails open.
 */
export function planVisibleComponentIds(): Promise<string[] | null> {
  return visibleStatusComponentIds()
}

/** Fetch the affected-component links (with component name/segmentIds) for a set of incidents. */
export async function getComponentLinksForIncidents(
  incidentIds: StatusIncidentId[]
): Promise<ComponentLinkRow[]> {
  if (incidentIds.length === 0) return []
  return (
    db
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
      // Page order, so the page, the feed's "Affected:" line and the emails
      // list an incident's services alike every time.
      .orderBy(asc(statusComponents.position), asc(statusComponents.id))
  )
}

export function groupLinksByIncident(
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

export async function projectIncidents(
  rows: IncidentRow[],
  linksByIncident: Map<StatusIncidentId, ComponentLinkRow[]>,
  actor: Actor
): Promise<PublicStatusIncident[]> {
  if (rows.length === 0) return []
  const [planVisible, allUpdates] = await Promise.all([
    planVisibleComponentIds(),
    db.query.statusIncidentUpdates.findMany({
      where: inArray(
        statusIncidentUpdates.incidentId,
        rows.map((r) => r.id)
      ),
      orderBy: [asc(statusIncidentUpdates.createdAt)],
    }),
  ])
  const updatesByIncident = new Map<StatusIncidentId, IncidentUpdateRow[]>()
  for (const update of allUpdates) {
    const existing = updatesByIncident.get(update.incidentId)
    if (existing) existing.push(update)
    else updatesByIncident.set(update.incidentId, [update])
  }
  const results: PublicStatusIncident[] = []
  for (const row of rows) {
    const projected = await toPublicIncident(
      row,
      linksByIncident.get(row.id) ?? [],
      actor,
      planVisible,
      updatesByIncident.get(row.id) ?? []
    )
    if (projected) results.push(projected)
  }
  return results
}
