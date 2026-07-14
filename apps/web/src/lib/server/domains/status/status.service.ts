/**
 * Status incident/maintenance lifecycle: create, update, post updates, resolve
 * + restore, backfill, template CRUD, and the publish notify-claim (Status
 * Product Spec §5-6, §9). Mirrors changelog.service.ts's structure.
 */
import {
  db,
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  asc,
  gte,
  ilike,
  lt,
  or,
  sql,
  statusIncidents,
  statusIncidentUpdates,
  statusIncidentComponents,
  statusComponents,
  statusComponentEvents,
  statusIncidentTemplates,
} from '@/lib/server/db'
import type {
  StatusIncidentId,
  StatusIncidentTemplateId,
  StatusComponentId,
  PrincipalId,
} from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { buildEventActor, type EventActor } from '@/lib/server/events/dispatch'
import { deriveImpact } from './status.calc'
import { reconcileComponentStatus, dispatchStatusEvent } from './status.components'
import { enqueueMaintenanceJobs, cancelMaintenanceJobs } from './status.maintenance'
import type {
  CreateStatusIncidentInput,
  UpdateStatusIncidentInput,
  PostIncidentUpdateInput,
  CreateStatusIncidentTemplateInput,
  UpdateStatusIncidentTemplateInput,
  StatusIncidentWithDetails,
  StatusIncidentTemplateRow,
  ListStatusIncidentsParams,
  StatusIncidentListResult,
  StatusComponentStatus,
} from './status.types'

const log = logger.child({ component: 'status-service' })

function validateTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  if (trimmed.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must not exceed 200 characters')
  }
  return trimmed
}

function validateBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw new ValidationError('VALIDATION_ERROR', 'Update body is required')
  return trimmed
}

/** A maintenance row applies its component statuses at window start
 *  (status.maintenance.ts), not at creation — a future 'scheduled' window
 *  must not show the public page as already under maintenance. Everything
 *  else (an incident, or a maintenance window created already in progress)
 *  applies immediately. Backfilled rows never apply component changes. */
function appliesComponentStatusNow(input: {
  kind: string
  status: string
  backfilled: boolean
}): boolean {
  if (input.backfilled) return false
  if (input.kind === 'maintenance' && input.status === 'scheduled') return false
  return true
}

// ============================================================================
// Create
// ============================================================================

export async function createIncident(
  input: CreateStatusIncidentInput,
  author: { principalId: PrincipalId }
): Promise<StatusIncidentWithDetails> {
  const title = validateTitle(input.title)
  const body = validateBody(input.body)
  if (input.affectedComponents.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'At least one affected component is required')
  }

  const backfilled = !!input.backfill
  const componentStatuses = input.affectedComponents.map((c) => c.componentStatus)
  const impact =
    input.kind === 'maintenance'
      ? ('maintenance' as const)
      : input.impactOverride
        ? (input.impact ?? 'none')
        : deriveImpact(componentStatuses)

  const startedAt = input.backfill?.startedAt ?? new Date()
  const resolvedAt = input.backfill?.resolvedAt ?? null

  const [incident] = await db
    .insert(statusIncidents)
    .values({
      kind: input.kind,
      title,
      status: input.status,
      impact,
      impactOverride: input.kind === 'incident' && !!input.impactOverride,
      scheduledStartAt: input.scheduledStartAt ?? null,
      scheduledEndAt: input.scheduledEndAt ?? null,
      autoStart: input.autoStart ?? true,
      autoComplete: input.autoComplete ?? true,
      startedAt,
      resolvedAt,
      backfilled,
      createdBy: author.principalId,
    })
    .returning()

  await db.insert(statusIncidentComponents).values(
    input.affectedComponents.map((c) => ({
      incidentId: incident.id,
      componentId: c.componentId,
      componentStatus: c.componentStatus,
    }))
  )

  await db.insert(statusIncidentUpdates).values({
    incidentId: incident.id,
    status: input.status,
    body,
    createdBy: author.principalId,
  })

  if (appliesComponentStatusNow({ kind: incident.kind, status: incident.status, backfilled })) {
    const source = incident.kind === 'incident' ? 'incident' : 'maintenance'
    for (const c of input.affectedComponents) {
      await reconcileComponentStatus(c.componentId, source, incident.id)
    }
  }

  if (incident.kind === 'maintenance') {
    await enqueueMaintenanceJobs(incident).catch((err) =>
      log.error({ err, incident_id: incident.id }, 'failed to enqueue maintenance jobs')
    )
  }

  if (!backfilled) {
    const actor = buildEventActor({ principalId: author.principalId })
    const notify = input.notifySubscribers ?? true
    notifyStatusIncidentPublished(incident.id, actor, notify).catch((err) =>
      log.error({ err, incident_id: incident.id }, 'failed to dispatch status publish event')
    )
  }

  return getStatusIncidentById(incident.id)
}

// ============================================================================
// Update
// ============================================================================

export async function updateIncident(
  id: StatusIncidentId,
  input: UpdateStatusIncidentInput
): Promise<StatusIncidentWithDetails> {
  const existing = await requireIncident(id)

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (input.title !== undefined) updateData.title = validateTitle(input.title)
  if (input.scheduledStartAt !== undefined) updateData.scheduledStartAt = input.scheduledStartAt
  if (input.scheduledEndAt !== undefined) updateData.scheduledEndAt = input.scheduledEndAt
  if (input.autoStart !== undefined) updateData.autoStart = input.autoStart
  if (input.autoComplete !== undefined) updateData.autoComplete = input.autoComplete

  let newComponentStatuses: StatusComponentStatus[] | null = null
  if (input.affectedComponents !== undefined) {
    if (input.affectedComponents.length === 0) {
      throw new ValidationError('VALIDATION_ERROR', 'At least one affected component is required')
    }
    newComponentStatuses = input.affectedComponents.map((c) => c.componentStatus)
  }

  if (input.impactOverride !== undefined) {
    updateData.impactOverride = existing.kind === 'incident' && input.impactOverride
  }
  const impactOverride =
    (updateData.impactOverride as boolean | undefined) ?? existing.impactOverride
  if (existing.kind === 'incident') {
    if (impactOverride && input.impact !== undefined) {
      updateData.impact = input.impact
    } else if (!impactOverride && newComponentStatuses) {
      updateData.impact = deriveImpact(newComponentStatuses)
    }
  }

  await db.update(statusIncidents).set(updateData).where(eq(statusIncidents.id, id))

  if (input.affectedComponents !== undefined) {
    const previousLinks = await db.query.statusIncidentComponents.findMany({
      where: eq(statusIncidentComponents.incidentId, id),
    })
    await db.delete(statusIncidentComponents).where(eq(statusIncidentComponents.incidentId, id))
    await db.insert(statusIncidentComponents).values(
      input.affectedComponents.map((c) => ({
        incidentId: id,
        componentId: c.componentId,
        componentStatus: c.componentStatus,
      }))
    )

    // Apply the new/changed target statuses live, if this incident is
    // currently in a state that applies component statuses at all.
    const nowLive = appliesComponentStatusNow({
      kind: existing.kind,
      status: existing.status,
      backfilled: existing.backfilled,
    })
    if (nowLive) {
      const source = existing.kind === 'incident' ? 'incident' : 'maintenance'
      const affected = new Set([
        ...previousLinks.map((link) => link.componentId),
        ...input.affectedComponents.map((component) => component.componentId),
      ])
      for (const componentId of affected) {
        await reconcileComponentStatus(componentId, source, id)
      }
    }
  }

  if (
    existing.kind === 'maintenance' &&
    (input.scheduledStartAt !== undefined ||
      input.scheduledEndAt !== undefined ||
      input.autoStart !== undefined ||
      input.autoComplete !== undefined)
  ) {
    await cancelMaintenanceJobs(existing).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to cancel previous maintenance schedule')
    )
    const refreshed = await requireIncident(id)
    await enqueueMaintenanceJobs(refreshed).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to reschedule maintenance jobs')
    )
  }

  return getStatusIncidentById(id)
}

// ============================================================================
// Post update / lifecycle
// ============================================================================

const TERMINAL_STATUS: Record<'incident' | 'maintenance', string> = {
  incident: 'resolved',
  maintenance: 'completed',
}

export async function postIncidentUpdate(
  id: StatusIncidentId,
  input: PostIncidentUpdateInput,
  author: { principalId: PrincipalId | null }
): Promise<StatusIncidentWithDetails> {
  const existing = await requireIncident(id)
  const body = validateBody(input.body)

  await db.insert(statusIncidentUpdates).values({
    incidentId: id,
    status: input.status,
    body,
    createdBy: author.principalId,
  })

  const becomesTerminal = input.status === TERMINAL_STATUS[existing.kind]
  // Posting 'in_progress' on a still-'scheduled' window is a real start:
  // pull the start bound to now (job guards + uptime derivation read it),
  // apply component statuses, and reschedule the auto-complete job — same
  // effects as handleMaintenanceStart, but with the admin's own words as
  // the single timeline row instead of the scheduler's canned copy.
  const startsMaintenance =
    existing.kind === 'maintenance' &&
    existing.status === 'scheduled' &&
    input.status === 'in_progress'

  const updateData: Record<string, unknown> = { status: input.status, updatedAt: new Date() }
  if (becomesTerminal && !existing.resolvedAt) {
    updateData.resolvedAt = new Date()
  }
  if (startsMaintenance) {
    await cancelMaintenanceJobs(existing).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to cancel maintenance jobs on manual start')
    )
    updateData.scheduledStartAt = new Date()
  }
  await db.update(statusIncidents).set(updateData).where(eq(statusIncidents.id, id))

  if (startsMaintenance) {
    const links = await db.query.statusIncidentComponents.findMany({
      where: eq(statusIncidentComponents.incidentId, id),
    })
    for (const link of links) {
      await reconcileComponentStatus(link.componentId, 'maintenance', id)
    }
    await enqueueMaintenanceJobs({
      ...existing,
      status: 'in_progress',
      scheduledStartAt: updateData.scheduledStartAt as Date,
    })
  }

  if (becomesTerminal && !input.skipRestore) {
    const links = await db.query.statusIncidentComponents.findMany({
      where: eq(statusIncidentComponents.incidentId, id),
    })
    const source = existing.kind === 'incident' ? 'incident' : 'maintenance'
    for (const link of links) {
      await reconcileComponentStatus(link.componentId, source, id)
    }
  }

  const actor: EventActor = author.principalId
    ? buildEventActor({ principalId: author.principalId })
    : { type: 'service', displayName: 'system' }
  await dispatchStatusEvent('status.incident_updated', actor, {
    incidentId: id,
    kind: existing.kind,
    status: input.status,
    body,
  }).catch((err) =>
    log.error({ err, incident_id: id }, 'failed to dispatch status.incident_updated')
  )

  return getStatusIncidentById(id)
}

/** Soft delete. Cancels any pending maintenance automation jobs. */
export async function deleteIncident(id: StatusIncidentId): Promise<void> {
  const existing = await requireIncident(id)

  if (existing.kind === 'maintenance') {
    await cancelMaintenanceJobs(existing).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to cancel maintenance jobs on delete')
    )
  }

  const result = await db
    .update(statusIncidents)
    .set({ deletedAt: new Date() })
    .where(and(eq(statusIncidents.id, id), isNull(statusIncidents.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('STATUS_INCIDENT_NOT_FOUND', `Status incident ${id} not found`)
  }
}

/**
 * Danger-zone reset (Status Product Spec §8): hard-deletes all resolved
 * incidents/maintenance (their updates + affected-component links cascade) and
 * the entire component status-event log that uptime bars derive from.
 * Components, groups, templates, subscriptions, and any still-open incident
 * are left untouched. Returns the counts removed.
 */
export async function clearStatusHistory(): Promise<{ incidents: number; events: number }> {
  const removedIncidents = await db
    .delete(statusIncidents)
    .where(isNotNull(statusIncidents.resolvedAt))
    .returning({ id: statusIncidents.id })

  const removedEvents = await db
    .delete(statusComponentEvents)
    .returning({ id: statusComponentEvents.id })

  log.info(
    { incidents: removedIncidents.length, events: removedEvents.length },
    'cleared status history'
  )
  return { incidents: removedIncidents.length, events: removedEvents.length }
}

// ============================================================================
// Read
// ============================================================================

async function requireIncident(id: StatusIncidentId) {
  const existing = await db.query.statusIncidents.findFirst({
    where: and(eq(statusIncidents.id, id), isNull(statusIncidents.deletedAt)),
  })
  if (!existing) {
    throw new NotFoundError('STATUS_INCIDENT_NOT_FOUND', `Status incident ${id} not found`)
  }
  return existing
}

export async function getStatusIncidentById(
  id: StatusIncidentId
): Promise<StatusIncidentWithDetails> {
  const incident = await requireIncident(id)

  const links = await db
    .select({
      componentId: statusIncidentComponents.componentId,
      componentStatus: statusIncidentComponents.componentStatus,
      name: statusComponents.name,
      segmentIds: statusComponents.segmentIds,
    })
    .from(statusIncidentComponents)
    .innerJoin(statusComponents, eq(statusIncidentComponents.componentId, statusComponents.id))
    .where(eq(statusIncidentComponents.incidentId, id))

  const updates = await db.query.statusIncidentUpdates.findMany({
    where: eq(statusIncidentUpdates.incidentId, id),
    orderBy: [asc(statusIncidentUpdates.createdAt)],
  })

  return {
    id: incident.id,
    kind: incident.kind,
    title: incident.title,
    status: incident.status,
    impact: incident.impact,
    impactOverride: incident.impactOverride,
    scheduledStartAt: incident.scheduledStartAt,
    scheduledEndAt: incident.scheduledEndAt,
    autoStart: incident.autoStart,
    autoComplete: incident.autoComplete,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    backfilled: incident.backfilled,
    notifiedAt: incident.notifiedAt,
    createdBy: incident.createdBy,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    affectedComponents: links,
    updates,
  }
}

export async function listStatusIncidents(
  params: ListStatusIncidentsParams
): Promise<StatusIncidentListResult> {
  const { kind, state = 'all', search, cursor, limit = 20 } = params
  const conditions = [isNull(statusIncidents.deletedAt)]
  if (kind) conditions.push(eq(statusIncidents.kind, kind))
  if (state === 'active') conditions.push(isNull(statusIncidents.resolvedAt))
  if (state === 'resolved') conditions.push(isNotNull(statusIncidents.resolvedAt))
  const term = search?.trim()
  if (term) conditions.push(ilike(statusIncidents.title, `%${term}%`))

  if (cursor) {
    const cursorRow = await db.query.statusIncidents.findFirst({
      where: eq(statusIncidents.id, cursor as StatusIncidentId),
      columns: { createdAt: true },
    })
    if (cursorRow) {
      conditions.push(
        or(
          lt(statusIncidents.createdAt, cursorRow.createdAt),
          and(
            eq(statusIncidents.createdAt, cursorRow.createdAt),
            lt(statusIncidents.id, cursor as StatusIncidentId)
          )
        )!
      )
    }
  }

  const rows = await db.query.statusIncidents.findMany({
    where: and(...conditions),
    orderBy: [desc(statusIncidents.createdAt), desc(statusIncidents.id)],
    limit: limit + 1,
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const details = await Promise.all(items.map((r) => getStatusIncidentById(r.id)))

  return {
    items: details,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

/** Incidents (not maintenance) whose clock started since `date` — the
 *  overview's "incidents in the last 30 days" tile. */
export async function countStatusIncidentsSince(date: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statusIncidents)
    .where(
      and(
        eq(statusIncidents.kind, 'incident'),
        isNull(statusIncidents.deletedAt),
        gte(statusIncidents.startedAt, date)
      )
    )
  return row?.count ?? 0
}

// ============================================================================
// Publish notification (changelog notifyChangelogPublished pattern)
// ============================================================================

/**
 * Announce a published incident/maintenance exactly once. Atomically claims
 * via `notified_at`, gated on `backfilled = false` so a backfilled row can
 * never be claimed (Status Product Spec §2). `notify=false` still performs
 * the claim (idempotence preserved) but skips the actual dispatch — mirrors
 * the changelog publish-checkbox semantics exactly.
 */
export async function notifyStatusIncidentPublished(
  id: StatusIncidentId,
  actor: EventActor,
  notify: boolean = true
): Promise<boolean> {
  const now = new Date()
  const [claimed] = await db
    .update(statusIncidents)
    .set({ notifiedAt: now })
    .where(
      and(
        eq(statusIncidents.id, id),
        isNull(statusIncidents.notifiedAt),
        eq(statusIncidents.backfilled, false),
        isNull(statusIncidents.deletedAt)
      )
    )
    .returning()

  if (!claimed) return false
  if (!notify) return true

  try {
    const links = await db.query.statusIncidentComponents.findMany({
      where: eq(statusIncidentComponents.incidentId, id),
      columns: { componentId: true },
    })
    const eventType =
      claimed.kind === 'incident' ? 'status.incident_created' : 'status.maintenance_scheduled'
    await dispatchStatusEvent(
      eventType,
      actor,
      {
        incident: {
          id: claimed.id,
          kind: claimed.kind,
          title: claimed.title,
          status: claimed.status,
          impact: claimed.impact,
          scheduledStartAt: claimed.scheduledStartAt?.toISOString() ?? null,
          scheduledEndAt: claimed.scheduledEndAt?.toISOString() ?? null,
          startedAt: claimed.startedAt.toISOString(),
          componentIds: links.map((l) => l.componentId),
        },
      },
      { rethrow: true }
    )
    return true
  } catch (err) {
    await db
      .update(statusIncidents)
      .set({ notifiedAt: null })
      .where(eq(statusIncidents.id, id))
      .catch(() => {})
    log.error({ err, incident_id: id }, 'failed to dispatch status publish event')
    return false
  }
}

/**
 * Safety net for publish notifications — mirrors
 * `reconcileChangelogNotifications`. Finds live, unclaimed, non-backfilled
 * incidents/maintenance and announces each.
 */
export async function reconcileStatusNotifications(): Promise<number> {
  const due = await db
    .select({ id: statusIncidents.id, createdBy: statusIncidents.createdBy })
    .from(statusIncidents)
    .where(
      and(
        isNull(statusIncidents.notifiedAt),
        eq(statusIncidents.backfilled, false),
        isNull(statusIncidents.deletedAt)
      )
    )
    .orderBy(asc(statusIncidents.createdAt))
    .limit(100)

  let notified = 0
  for (const row of due) {
    const actor: EventActor = row.createdBy
      ? buildEventActor({ principalId: row.createdBy })
      : { type: 'service', displayName: 'scheduler' }
    if (await notifyStatusIncidentPublished(row.id, actor)) notified++
  }
  return notified
}

// ============================================================================
// Templates
// ============================================================================

function toTemplateRow(
  row: typeof statusIncidentTemplates.$inferSelect
): StatusIncidentTemplateRow {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    body: row.body,
    impact: row.impact,
    componentIds: row.componentIds as StatusComponentId[],
  }
}

export async function listStatusIncidentTemplates(): Promise<StatusIncidentTemplateRow[]> {
  const rows = await db.query.statusIncidentTemplates.findMany({
    orderBy: [asc(statusIncidentTemplates.name)],
  })
  return rows.map(toTemplateRow)
}

export async function createStatusIncidentTemplate(
  input: CreateStatusIncidentTemplateInput
): Promise<StatusIncidentTemplateRow> {
  const name = validateTitle(input.name)
  const title = validateTitle(input.title)
  const body = validateBody(input.body)

  const [row] = await db
    .insert(statusIncidentTemplates)
    .values({
      name,
      title,
      body,
      impact: input.impact ?? 'minor',
      componentIds: input.componentIds ?? [],
    })
    .returning()

  return toTemplateRow(row)
}

export async function updateStatusIncidentTemplate(
  id: StatusIncidentTemplateId,
  input: UpdateStatusIncidentTemplateInput
): Promise<StatusIncidentTemplateRow> {
  const existing = await db.query.statusIncidentTemplates.findFirst({
    where: eq(statusIncidentTemplates.id, id),
  })
  if (!existing) {
    throw new NotFoundError('STATUS_TEMPLATE_NOT_FOUND', `Status incident template ${id} not found`)
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = validateTitle(input.name)
  if (input.title !== undefined) updateData.title = validateTitle(input.title)
  if (input.body !== undefined) updateData.body = validateBody(input.body)
  if (input.impact !== undefined) updateData.impact = input.impact
  if (input.componentIds !== undefined) updateData.componentIds = input.componentIds

  const [updated] = await db
    .update(statusIncidentTemplates)
    .set(updateData)
    .where(eq(statusIncidentTemplates.id, id))
    .returning()

  return toTemplateRow(updated)
}

export async function deleteStatusIncidentTemplate(id: StatusIncidentTemplateId): Promise<void> {
  const result = await db
    .delete(statusIncidentTemplates)
    .where(eq(statusIncidentTemplates.id, id))
    .returning({ id: statusIncidentTemplates.id })

  if (result.length === 0) {
    throw new NotFoundError('STATUS_TEMPLATE_NOT_FOUND', `Status incident template ${id} not found`)
  }
}
