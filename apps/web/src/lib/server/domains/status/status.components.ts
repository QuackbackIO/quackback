/**
 * Status component + group CRUD, manual/API status writes, and the shared
 * event-writing helpers used by every status.* module (kept here — the
 * dependency-free leaf of the domain — so status.service.ts and
 * status.maintenance.ts can both import it without a cycle).
 */
import { invalidatePlanLimits } from '@/lib/server/domains/plan-limits/plan-limits.cache'
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  asc,
  sql,
  statusComponentGroups,
  statusComponents,
  statusComponentEvents,
  statusIncidentComponents,
  statusIncidents,
} from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import type { StatusComponentId, StatusComponentGroupId, StatusIncidentId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { assertTrimmedName, nextPosition, positionCaseSql } from '@/lib/server/utils'
import type { EventActor } from '@/lib/server/events/dispatch'
import type { EventData } from '@/lib/server/events/types'
import type {
  StatusComponentStatus,
  StatusComponentEventSource,
  CreateStatusComponentGroupInput,
  UpdateStatusComponentGroupInput,
  CreateStatusComponentInput,
  UpdateStatusComponentInput,
  StatusComponentGroupWithComponents,
  StatusComponentRow,
} from './status.types'

/** The global handle, or a transaction a lifecycle write is running in. */
type Executor = Database | Transaction

function validateName(name: string, label: string): string {
  return assertTrimmedName(
    name,
    {
      required: `${label} name is required`,
      tooLong: `${label} name must not exceed 200 characters`,
    },
    200
  )
}

function toComponentRow(row: typeof statusComponents.$inferSelect): StatusComponentRow {
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    description: row.description,
    status: row.status,
    position: row.position,
    showUptime: row.showUptime,
    segmentIds: row.segmentIds,
  }
}

// ============================================================================
// Groups
// ============================================================================

export async function createStatusComponentGroup(
  input: CreateStatusComponentGroupInput
): Promise<StatusComponentGroupWithComponents> {
  const name = validateName(input.name, 'Group')
  const [group] = await db
    .insert(statusComponentGroups)
    .values({
      name,
      collapsed: input.collapsed ?? false,
      position: await nextPosition(statusComponentGroups, statusComponentGroups.position),
    })
    .returning()

  return {
    id: group.id,
    name: group.name,
    position: group.position,
    collapsed: group.collapsed,
    components: [],
  }
}

export async function updateStatusComponentGroup(
  id: StatusComponentGroupId,
  input: UpdateStatusComponentGroupInput
): Promise<void> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = validateName(input.name, 'Group')
  if (input.collapsed !== undefined) updateData.collapsed = input.collapsed

  const result = await db
    .update(statusComponentGroups)
    .set(updateData)
    .where(eq(statusComponentGroups.id, id))
    .returning({ id: statusComponentGroups.id })

  if (result.length === 0) {
    throw new NotFoundError('STATUS_GROUP_NOT_FOUND', `Status component group ${id} not found`)
  }
}

/** Hard delete — components in the group fall back to ungrouped (FK ON DELETE SET NULL). */
export async function deleteStatusComponentGroup(id: StatusComponentGroupId): Promise<void> {
  const result = await db
    .delete(statusComponentGroups)
    .where(eq(statusComponentGroups.id, id))
    .returning({ id: statusComponentGroups.id })

  if (result.length === 0) {
    throw new NotFoundError('STATUS_GROUP_NOT_FOUND', `Status component group ${id} not found`)
  }
  await invalidatePlanLimits()
}

export async function reorderStatusComponentGroups(ids: StatusComponentGroupId[]): Promise<void> {
  if (!ids || ids.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Group IDs are required')
  }
  await db
    .update(statusComponentGroups)
    .set({ position: positionCaseSql(statusComponentGroups.id, ids) })
    .where(inArray(statusComponentGroups.id, ids))
  await invalidatePlanLimits()
}

/** Admin (unfiltered) list — groups with their non-deleted components, ordered. */
export async function listStatusComponentGroupsWithComponents(): Promise<
  StatusComponentGroupWithComponents[]
> {
  const groups = await db.query.statusComponentGroups.findMany({
    orderBy: [asc(statusComponentGroups.position)],
  })
  const components = await db.query.statusComponents.findMany({
    where: isNull(statusComponents.deletedAt),
    orderBy: [asc(statusComponents.position)],
  })

  const byGroup = new Map<StatusComponentGroupId, StatusComponentRow[]>()
  for (const c of components) {
    if (!c.groupId) continue
    const list = byGroup.get(c.groupId) ?? []
    list.push(toComponentRow(c))
    byGroup.set(c.groupId, list)
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    position: g.position,
    collapsed: g.collapsed,
    components: byGroup.get(g.id) ?? [],
  }))
}

export async function listUngroupedStatusComponents(): Promise<StatusComponentRow[]> {
  const components = await db.query.statusComponents.findMany({
    where: and(isNull(statusComponents.deletedAt), isNull(statusComponents.groupId)),
    orderBy: [asc(statusComponents.position)],
  })
  return components.map(toComponentRow)
}

// ============================================================================
// Components
// ============================================================================

export async function createStatusComponent(
  input: CreateStatusComponentInput
): Promise<StatusComponentRow> {
  const name = validateName(input.name, 'Component')
  const [component] = await db
    .insert(statusComponents)
    .values({
      name,
      description: input.description ?? null,
      groupId: input.groupId ?? null,
      status: input.status ?? 'operational',
      showUptime: input.showUptime ?? true,
      segmentIds: input.segmentIds ?? [],
      position: await nextPosition(statusComponents, statusComponents.position),
    })
    .returning()

  await invalidatePlanLimits()
  return toComponentRow(component)
}

async function getComponentOrThrow(id: StatusComponentId) {
  const existing = await db.query.statusComponents.findFirst({
    where: and(eq(statusComponents.id, id), isNull(statusComponents.deletedAt)),
  })
  if (!existing) {
    throw new NotFoundError('STATUS_COMPONENT_NOT_FOUND', `Status component ${id} not found`)
  }
  return existing
}

export async function updateStatusComponent(
  id: StatusComponentId,
  input: UpdateStatusComponentInput
): Promise<StatusComponentRow> {
  await getComponentOrThrow(id)

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = validateName(input.name, 'Component')
  if (input.description !== undefined) updateData.description = input.description
  if (input.groupId !== undefined) updateData.groupId = input.groupId
  if (input.showUptime !== undefined) updateData.showUptime = input.showUptime
  if (input.segmentIds !== undefined) updateData.segmentIds = input.segmentIds

  const [updated] = await db
    .update(statusComponents)
    .set(updateData)
    .where(eq(statusComponents.id, id))
    .returning()

  return toComponentRow(updated)
}

/** Soft delete — keeps incident history (affected-component links) readable.
 *  Lifecycle writes skip a deleted component (reconcileComponentStatus), and
 *  the admin incident detail and templates leave it out, so an open incident
 *  that used it still resolves, and the editor stops resubmitting it. */
export async function deleteStatusComponent(id: StatusComponentId): Promise<void> {
  const result = await db
    .update(statusComponents)
    .set({ deletedAt: new Date() })
    .where(and(eq(statusComponents.id, id), isNull(statusComponents.deletedAt)))
    .returning({ id: statusComponents.id })

  if (result.length === 0) {
    throw new NotFoundError('STATUS_COMPONENT_NOT_FOUND', `Status component ${id} not found`)
  }
  await invalidatePlanLimits()
}

export async function reorderStatusComponents(ids: StatusComponentId[]): Promise<void> {
  if (!ids || ids.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Component IDs are required')
  }
  // Locked in id order first, like a lifecycle recompute takes them (see
  // reconcileComponentStatus). A bare UPDATE locks rows in whatever order the
  // database scans them, so against a recompute sharing two or more of these
  // services each could hold one the other waits for.
  await db.transaction(async (tx) => {
    await tx
      .select({ id: statusComponents.id })
      .from(statusComponents)
      .where(inArray(statusComponents.id, ids))
      .orderBy(asc(statusComponents.id))
      .for('no key update')
    await tx
      .update(statusComponents)
      .set({ position: positionCaseSql(statusComponents.id, ids) })
      .where(inArray(statusComponents.id, ids))
  })
  // Display order picks which components stay public over the cap.
  await invalidatePlanLimits()
}

/**
 * Set a component's live status and append the append-only event row uptime
 * bars are derived from (Status Product Spec §5). A no-op (no update, no
 * event) when the status is unchanged, so incident lifecycle churn that
 * re-asserts the same status doesn't spam the history or emit an event.
 *
 * `status.component_changed` only fires for 'manual'/'api' sources — incident
 * and maintenance-driven changes are already covered by their own
 * incident/maintenance events (avoids duplicate notifications for one action).
 */
export async function setComponentStatus(
  componentId: StatusComponentId,
  status: StatusComponentStatus,
  source: StatusComponentEventSource,
  incidentId?: StatusIncidentId | null
): Promise<void> {
  // The row is locked and read inside the transaction, so the previous
  // status in the event is the one this write replaced, and the change, its
  // history row and its event commit together or not at all.
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(statusComponents)
      .where(and(eq(statusComponents.id, componentId), isNull(statusComponents.deletedAt)))
      .for('no key update')
    if (!locked) {
      throw new NotFoundError(
        'STATUS_COMPONENT_NOT_FOUND',
        `Status component ${componentId} not found`
      )
    }
    if (locked.status === status) return
    await writeComponentStatus(locked, status, source, incidentId, tx)

    if (source === 'manual' || source === 'api') {
      const actor: EventActor = { type: 'service', displayName: source }
      await writeStatusEvent(
        'status.component_changed',
        actor,
        {
          componentId: locked.id,
          componentName: locked.name,
          previousStatus: locked.status,
          status,
          source,
        },
        tx
      )
    }
  })
}

async function writeComponentStatus(
  existing: typeof statusComponents.$inferSelect,
  status: StatusComponentStatus,
  source: StatusComponentEventSource,
  incidentId: StatusIncidentId | null | undefined,
  executor: Executor
): Promise<void> {
  if (existing.status === status) return

  await executor
    .update(statusComponents)
    .set({ status, updatedAt: new Date() })
    .where(eq(statusComponents.id, existing.id))

  await executor.insert(statusComponentEvents).values({
    componentId: existing.id,
    status,
    source,
    incidentId: incidentId ?? null,
  })
}

const STATUS_WEIGHT: Record<StatusComponentStatus, number> = {
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
}

/** Whether a row in this status holds its services at their affected status.
 *  Mirrors the active-set filter in reconcileComponentStatus's query below. A
 *  write recomputes a row's services only when the row holds them before or
 *  after it: recomputing for a row that holds them neither way would only
 *  reset a status set by hand or through the API since. */
export function holdsComponents(kind: string, status: string): boolean {
  if (kind === 'incident') return status !== 'resolved'
  return status === 'in_progress' || status === 'verifying'
}

/**
 * Recompute a component from every currently active incident/window. A
 * soft-deleted component is skipped rather than thrown on: it is off the page
 * and has no live status, but an incident that still links to it must stay
 * resolvable, reopenable and deletable, and its other components must still
 * be recomputed. Pass `executor` to run inside the caller's transaction.
 */
export async function reconcileComponentStatus(
  componentId: StatusComponentId,
  source: StatusComponentEventSource,
  incidentId?: StatusIncidentId | null,
  executor: Executor = db
): Promise<void> {
  // Lock the component before reading which incidents hold it. Two lifecycle
  // writes sharing a component (say, two incidents deleted at once) would
  // otherwise each read the other's change as not yet made, and the later
  // commit would restore a status neither incident still sets. Holding the
  // row, the second waits for the first to commit and then reads its result.
  // NO KEY UPDATE, not UPDATE: a caller has usually just inserted a link to
  // this service, whose foreign key check holds KEY SHARE on the row. Two
  // writes linking the same service both hold it, and FOR UPDATE would make
  // each wait on the other's (a deadlock); NO KEY UPDATE still serialises
  // recomputes against each other without conflicting with it.
  //
  // Lock order: lifecycle writes lock and refresh their incident row before
  // this (lockIncident in status.service.ts, or the scheduler's claim), then
  // take services in id order (reconcileComponentStatuses), and reordering
  // services takes them in id order too. Two of these never wait on each
  // other in a cycle. The one write that can't be ordered is deleting a
  // group: its ON DELETE SET NULL cascade updates the group's services in
  // the order the database scans them, so against a recompute sharing two or
  // more of them, Postgres may abort one of the two as a deadlock.
  const [component] = await executor
    .select()
    .from(statusComponents)
    .where(and(eq(statusComponents.id, componentId), isNull(statusComponents.deletedAt)))
    .for('no key update')
  if (!component) return

  const active = await executor
    .select({ status: statusIncidentComponents.componentStatus })
    .from(statusIncidentComponents)
    .innerJoin(statusIncidents, eq(statusIncidents.id, statusIncidentComponents.incidentId))
    .where(
      and(
        eq(statusIncidentComponents.componentId, componentId),
        isNull(statusIncidents.deletedAt),
        sql`(
          (${statusIncidents.kind} = 'incident' and ${statusIncidents.status} <> 'resolved')
          or
          (${statusIncidents.kind} = 'maintenance' and ${statusIncidents.status} in ('in_progress', 'verifying'))
        )`
      )
    )
  const effective = active.reduce<StatusComponentStatus>(
    (worst, row) => (STATUS_WEIGHT[row.status] > STATUS_WEIGHT[worst] ? row.status : worst),
    'operational'
  )
  await writeComponentStatus(component, effective, source, incidentId, executor)
}

/**
 * Recompute several components in one lifecycle write. They are locked in id
 * order, so two writes that share components always take them in the same
 * order and can't deadlock.
 */
export async function reconcileComponentStatuses(
  componentIds: Iterable<StatusComponentId>,
  source: StatusComponentEventSource,
  incidentId: StatusIncidentId | null | undefined,
  executor: Executor
): Promise<void> {
  for (const componentId of [...new Set(componentIds)].sort()) {
    await reconcileComponentStatus(componentId, source, incidentId, executor)
  }
}

// ============================================================================
// Shared event-writing helpers (see module docblock)
// ============================================================================

/** Status event types this domain emits. */
export type StatusEventType =
  | 'status.incident_created'
  | 'status.incident_updated'
  | 'status.maintenance_scheduled'
  | 'status.maintenance_started'
  | 'status.maintenance_completed'
  | 'status.component_changed'

/** A status event as the envelope the outbox writer takes. */
export function buildStatusEvent(
  type: StatusEventType,
  actor: EventActor,
  data: Record<string, unknown>
): EventData {
  return {
    id: globalThis.crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    actor,
    data,
  } as unknown as EventData
}

/**
 * Write a status event on the transaction that makes the change it describes,
 * so the two commit or roll back together and a crash can't lose the event.
 */
export async function writeStatusEvent(
  type: StatusEventType,
  actor: EventActor,
  data: Record<string, unknown>,
  tx: Transaction
): Promise<void> {
  const { writeEventToOutbox } = await import('@/lib/server/events/outbox-dispatch')
  await writeEventToOutbox(buildStatusEvent(type, actor, data), tx)
}
