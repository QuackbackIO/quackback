/**
 * Status component + group CRUD, manual/API status writes, and the shared
 * event-dispatch bridge used by every status.* module (kept here — the
 * dependency-free leaf of the domain — so status.service.ts and
 * status.maintenance.ts can both import it without a cycle).
 */
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
} from '@/lib/server/db'
import type { StatusComponentId, StatusComponentGroupId, StatusIncidentId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import type { EventActor } from '@/lib/server/events/dispatch'
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

const log = logger.child({ component: 'status-components' })

function validateName(name: string, label: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ValidationError('VALIDATION_ERROR', `${label} name is required`)
  if (trimmed.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', `${label} name must not exceed 200 characters`)
  }
  return trimmed
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
  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${statusComponentGroups.position}), -1)::int` })
    .from(statusComponentGroups)

  const [group] = await db
    .insert(statusComponentGroups)
    .values({ name, collapsed: input.collapsed ?? false, position: maxPosition + 1 })
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
}

export async function reorderStatusComponentGroups(ids: StatusComponentGroupId[]): Promise<void> {
  if (!ids || ids.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Group IDs are required')
  }
  const cases = ids
    .map((id, i) => sql`WHEN ${statusComponentGroups.id} = ${id} THEN ${sql.raw(String(i))}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)

  await db
    .update(statusComponentGroups)
    .set({ position: sql`CASE ${cases} END` })
    .where(inArray(statusComponentGroups.id, ids))
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
  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${statusComponents.position}), -1)::int` })
    .from(statusComponents)

  const [component] = await db
    .insert(statusComponents)
    .values({
      name,
      description: input.description ?? null,
      groupId: input.groupId ?? null,
      status: input.status ?? 'operational',
      showUptime: input.showUptime ?? true,
      segmentIds: input.segmentIds ?? [],
      position: maxPosition + 1,
    })
    .returning()

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

/** Soft delete — keeps incident history (affected-component links) readable. */
export async function deleteStatusComponent(id: StatusComponentId): Promise<void> {
  const result = await db
    .update(statusComponents)
    .set({ deletedAt: new Date() })
    .where(and(eq(statusComponents.id, id), isNull(statusComponents.deletedAt)))
    .returning({ id: statusComponents.id })

  if (result.length === 0) {
    throw new NotFoundError('STATUS_COMPONENT_NOT_FOUND', `Status component ${id} not found`)
  }
}

export async function reorderStatusComponents(ids: StatusComponentId[]): Promise<void> {
  if (!ids || ids.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Component IDs are required')
  }
  const cases = ids
    .map((id, i) => sql`WHEN ${statusComponents.id} = ${id} THEN ${sql.raw(String(i))}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)

  await db
    .update(statusComponents)
    .set({ position: sql`CASE ${cases} END` })
    .where(inArray(statusComponents.id, ids))
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
  const existing = await getComponentOrThrow(componentId)
  if (existing.status === status) return

  await db
    .update(statusComponents)
    .set({ status, updatedAt: new Date() })
    .where(eq(statusComponents.id, componentId))

  await db.insert(statusComponentEvents).values({
    componentId,
    status,
    source,
    incidentId: incidentId ?? null,
  })

  if (source === 'manual' || source === 'api') {
    const actor: EventActor = { type: 'service', displayName: source }
    await dispatchStatusEvent('status.component_changed', actor, {
      componentId,
      componentName: existing.name,
      previousStatus: existing.status,
      status,
      source,
    }).catch((err) =>
      log.error({ err, component_id: componentId }, 'failed to dispatch status.component_changed')
    )
  }
}

// ============================================================================
// Shared event-dispatch bridge (see module docblock)
// ============================================================================

/**
 * Status event types this domain emits. NOT yet registered in
 * `events/types.ts`'s `EventType` union — see the dispatch note below.
 */
export type StatusEventType =
  | 'status.incident_created'
  | 'status.incident_updated'
  | 'status.maintenance_scheduled'
  | 'status.maintenance_started'
  | 'status.maintenance_completed'
  | 'status.component_changed'

/**
 * Mirrors the private `dispatchEvent` helper in events/dispatch.ts (best-effort,
 * optional rethrow), but lives in the status domain: `status.*` isn't in the
 * events/ package's `EventType` union / `EventData` discriminated union yet
 * (owned by another workstream — see this domain's final build report for the
 * exact registry/targets/handlers wiring it needs). The cast below is the
 * deliberate bridge until that lands. Runtime behavior is safe either way:
 * `processEvent` resolves zero hook targets for an unregistered type today
 * (no webhook/workflow config can reference a type that doesn't exist yet),
 * and starts actually notifying the moment the registry is updated, with zero
 * further domain-layer changes.
 */
export async function dispatchStatusEvent(
  type: StatusEventType,
  actor: EventActor,
  data: Record<string, unknown>,
  opts?: { rethrow?: boolean }
): Promise<void> {
  const event = {
    id: globalThis.crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    actor,
    data,
  }
  try {
    const { processEvent } = await import('@/lib/server/events/process')
    await processEvent(event as unknown as Parameters<typeof processEvent>[0])
  } catch (err) {
    log.error({ err, event_type: type }, 'failed to dispatch status event')
    if (opts?.rethrow) throw err
  }
}
