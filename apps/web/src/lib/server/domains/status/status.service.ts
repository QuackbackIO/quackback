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
  inArray,
  lt,
  lte,
  or,
  sql,
  statusIncidents,
  statusIncidentUpdates,
  statusIncidentComponents,
  statusComponents,
  statusComponentEvents,
  statusIncidentTemplates,
  type Database,
  type Transaction,
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
import type { EventData } from '@/lib/server/events/types'
import { deriveImpact } from './status.calc'
import { reconcileComponentStatuses, writeStatusEvent, holdsComponents } from './status.components'
import {
  enqueueMaintenanceJobs,
  cancelMaintenanceJobs,
  settleMaintenanceStart,
} from './status.maintenance'
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
} from './status.types'

const log = logger.child({ component: 'status-service' })

/** The global handle, or the transaction a lifecycle write is running in. */
type Executor = Database | Transaction

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

const LIFECYCLE_STATUSES: Record<'incident' | 'maintenance', readonly string[]> = {
  incident: ['investigating', 'identified', 'monitoring', 'resolved'],
  maintenance: ['scheduled', 'in_progress', 'verifying', 'completed'],
}

const TERMINAL_STATUS: Record<'incident' | 'maintenance', string> = {
  incident: 'resolved',
  maintenance: 'completed',
}

/** The two kinds share one status column but not one vocabulary: a
 *  maintenance status on an incident (or the reverse) would never match any
 *  lifecycle check and strand the row, so reject it as bad input. */
function assertStatusMatchesKind(kind: 'incident' | 'maintenance', status: string): void {
  const allowed = LIFECYCLE_STATUSES[kind]
  if (allowed.includes(status)) return
  throw new ValidationError(
    'VALIDATION_ERROR',
    `"${status}" is not ${kind === 'incident' ? 'an incident' : 'a maintenance'} status. Use one of: ${allowed.join(', ')}.`
  )
}

const KIND_NOUN: Record<'incident' | 'maintenance', string> = {
  incident: 'incident',
  maintenance: 'maintenance window',
}

/** A logged past incident (a backfill) is a historical record: resolved from
 *  the moment it is logged and never live again. A live status on one would
 *  list it as active from its past start and, once anything recomputed its
 *  services, hold them at the statuses it had then. */
function assertBackfillStaysResolved(
  kind: 'incident' | 'maintenance',
  status: string,
  reopening: boolean
): void {
  if (status === TERMINAL_STATUS[kind]) return
  throw new ValidationError(
    'VALIDATION_ERROR',
    reopening
      ? `A logged past ${KIND_NOUN[kind]} can't be reopened. ${kind === 'incident' ? 'Report a new incident' : 'Schedule a new window'} instead.`
      : `A past ${KIND_NOUN[kind]} is logged as ${TERMINAL_STATUS[kind]}. Use the "${TERMINAL_STATUS[kind]}" status.`
  )
}

/** A window must end after it starts. Checked server-side so the API and a
 *  stale editor can't store a window that auto-completes before it begins. */
function assertWindowOrder(start: Date | null | undefined, end: Date | null | undefined): void {
  if (start && end && end.getTime() <= start.getTime()) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'The scheduled end must be after the scheduled start'
    )
  }
}

/** A create or a stale editor naming a service that has since been deleted.
 *  Worded for the dashboard and API callers alike. */
const DELETED_SERVICE_MESSAGE = 'An affected service has been deleted. Choose the services again.'

/** The subset of `ids` that are live (not soft-deleted) services. */
async function liveComponentIds(
  ids: StatusComponentId[],
  executor: Executor
): Promise<Set<StatusComponentId>> {
  if (ids.length === 0) return new Set()
  const rows = await executor
    .select({ id: statusComponents.id })
    .from(statusComponents)
    .where(and(inArray(statusComponents.id, ids), isNull(statusComponents.deletedAt)))
  return new Set(rows.map((r) => r.id))
}

/**
 * Manual lifecycle writes lock and refresh the incident row first. This locks
 * the row for the rest of the transaction and returns it as it stands now,
 * and the write takes every decision from that row, never from one read
 * before the transaction. The scheduler's start and complete claims are
 * UPDATEs that take the same row lock, so a manual write racing one waits
 * for it and then sees what it did (a window the scheduler started isn't
 * started again, and its real start isn't overwritten).
 *
 * NO KEY UPDATE, not UPDATE: inserting a timeline row or a service link holds
 * KEY SHARE on this row through its foreign key, which NO KEY UPDATE doesn't
 * conflict with. Taken before anything else in the transaction, so locks are
 * always taken incident row first, then services in id order
 * (reconcileComponentStatuses).
 */
async function lockIncident(id: StatusIncidentId, tx: Transaction) {
  const [row] = await tx
    .select()
    .from(statusIncidents)
    .where(and(eq(statusIncidents.id, id), isNull(statusIncidents.deletedAt)))
    .for('no key update')
  if (!row) {
    throw new NotFoundError('STATUS_INCIDENT_NOT_FOUND', `Status incident ${id} not found`)
  }
  return row
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
  assertStatusMatchesKind(input.kind, input.status)
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

  assertWindowOrder(input.scheduledStartAt, input.scheduledEndAt)
  if (input.backfill) assertBackfillStaysResolved(input.kind, input.status, false)
  if (input.backfill && input.backfill.resolvedAt.getTime() <= input.backfill.startedAt.getTime()) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'A past incident must be resolved after it started'
    )
  }

  // Created already resolved or completed (the API allows it): it is history
  // from the start, so it is stamped resolved now and, holding nothing, never
  // touches its services.
  const now = new Date()
  const terminal = input.status === TERMINAL_STATUS[input.kind]
  const resolvedAt = input.backfill?.resolvedAt ?? (terminal ? now : null)

  // started_at is when the row actually started. A window that hasn't run
  // (still 'scheduled', or created already completed) holds its planned start
  // in the column (NOT NULL), never later than it completed;
  // handleMaintenanceStart / a manual start overwrite it with the real one.
  const plannedStart =
    input.kind === 'maintenance' && (input.status === 'scheduled' || terminal)
      ? input.scheduledStartAt
      : null
  const startedAt =
    input.backfill?.startedAt ??
    (plannedStart && (!resolvedAt || plannedStart <= resolvedAt) ? plannedStart : now)

  // A publication is claimed at create: notified_at is stamped and the
  // publish event written on the create transaction, so the event always
  // precedes the window's own transition events. The event is what drives the
  // subscriber fan-out; with "Email subscribers" off it carries that flag and
  // no email follows. An older version's sweep doesn't
  // read notify_subscribers and announces every live row with no
  // notified_at, so the stamp is what keeps one rolled back to (or an old
  // worker mid-deploy) from sending it. Readers tell a quiet row apart by
  // notify_subscribers. A backfill is never announced by any version and
  // keeps notified_at null. The sweep still announces rows an older version
  // left unclaimed.
  const notifySubscribers = !backfilled && (input.notifySubscribers ?? true)
  const notifiedAt = !backfilled ? now : null

  // One transaction: the row, its links, the first update and the component
  // statuses it applies land together or not at all, so a failure part-way
  // can't leave a published incident with no timeline or no services.
  const incident = await db.transaction(async (tx) => {
    const requested = input.affectedComponents.map((c) => c.componentId)
    const live = await liveComponentIds(requested, tx)
    if (requested.some((id) => !live.has(id))) {
      throw new ValidationError('VALIDATION_ERROR', DELETED_SERVICE_MESSAGE)
    }

    const [created] = await tx
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
        notifySubscribers,
        notifiedAt,
        createdBy: author.principalId,
      })
      .returning()

    await tx.insert(statusIncidentComponents).values(
      input.affectedComponents.map((c) => ({
        incidentId: created.id,
        componentId: c.componentId,
        componentStatus: c.componentStatus,
      }))
    )

    await tx.insert(statusIncidentUpdates).values({
      incidentId: created.id,
      status: input.status,
      body,
      createdBy: author.principalId,
      templateId: input.templateId ?? null,
      // A logged past incident's summary belongs to its resolution, not to
      // the moment it was logged, or the timeline dates it days late. A
      // window created already under way is dated at the start it records,
      // so started_at and its start update agree to the millisecond.
      ...(input.backfill
        ? { createdAt: input.backfill.resolvedAt }
        : input.kind === 'maintenance' && holdsComponents(input.kind, input.status)
          ? { createdAt: startedAt }
          : {}),
    })

    if (created.kind === 'maintenance') await settleMaintenanceStart(created.id, tx)

    // Only a row that holds its services applies them: not a backfill, a
    // window still scheduled, or one created already resolved or completed.
    if (!backfilled && holdsComponents(created.kind, created.status)) {
      const source = created.kind === 'incident' ? 'incident' : 'maintenance'
      await reconcileComponentStatuses(
        input.affectedComponents.map((c) => c.componentId),
        source,
        created.id,
        tx
      )
    }

    // The publish event commits with the row, or not at all; the row is
    // already stamped notified, so no sweep sends it a second time.
    if (!backfilled) {
      const { writeEventToOutbox } = await import('@/lib/server/events/outbox-dispatch')
      await writeEventToOutbox(
        statusPublishEvent(
          created,
          input.affectedComponents.map((c) => c.componentId),
          buildEventActor({ principalId: author.principalId })
        ),
        tx
      )
    }

    // A window created already under way, or already finished, has made its
    // transition at create: announce it here, in the same transaction, so the
    // scheduler (which only moves a window still scheduled or still running)
    // has nothing left to add for it. A backfill is history and says nothing.
    if (!backfilled && created.kind === 'maintenance' && created.status !== 'scheduled') {
      await writeStatusEvent(
        created.status === 'completed'
          ? 'status.maintenance_completed'
          : 'status.maintenance_started',
        buildEventActor({ principalId: author.principalId }),
        {
          incidentId: created.id,
          title: created.title,
          componentIds: input.affectedComponents.map((c) => c.componentId),
        },
        tx
      )
    }
    return created
  })

  // Jobs reach outside this database, so they run only once the rows above
  // (the publish event included) are committed.
  if (incident.kind === 'maintenance') {
    await enqueueMaintenanceJobs(incident).catch((err) =>
      log.error({ err, incident_id: incident.id }, 'failed to enqueue maintenance jobs')
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
  const title = input.title !== undefined ? validateTitle(input.title) : undefined
  if (input.affectedComponents !== undefined && input.affectedComponents.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'At least one affected component is required')
  }

  const existing = await db.transaction(async (tx) => {
    const existing = await lockIncident(id, tx)

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (title !== undefined) updateData.title = title
    if (input.scheduledStartAt !== undefined) updateData.scheduledStartAt = input.scheduledStartAt
    if (input.scheduledEndAt !== undefined) updateData.scheduledEndAt = input.scheduledEndAt
    if (input.autoStart !== undefined) updateData.autoStart = input.autoStart
    if (input.autoComplete !== undefined) updateData.autoComplete = input.autoComplete

    // details_edited_at records a change a status feed item shows: the
    // title, the window or the services, compared with the locked row so a
    // stale save that reverts a change still counts. The editor autosaves its
    // whole sidebar, so a value sent back unchanged, or a change to
    // automation or impact alone, is not an edit a reader needs to hear about.
    const sameInstant = (a: Date | null, b: Date | null) =>
      (a?.getTime() ?? null) === (b?.getTime() ?? null)
    let detailsChanged =
      (title !== undefined && title !== existing.title) ||
      (input.scheduledStartAt !== undefined &&
        !sameInstant(input.scheduledStartAt, existing.scheduledStartAt)) ||
      (input.scheduledEndAt !== undefined &&
        !sameInstant(input.scheduledEndAt, existing.scheduledEndAt))

    if (input.scheduledStartAt !== undefined || input.scheduledEndAt !== undefined) {
      assertWindowOrder(
        input.scheduledStartAt !== undefined ? input.scheduledStartAt : existing.scheduledStartAt,
        input.scheduledEndAt !== undefined ? input.scheduledEndAt : existing.scheduledEndAt
      )
    }
    // A window that hasn't started keeps its planned start in started_at, so a
    // reschedule moves it along.
    if (
      existing.kind === 'maintenance' &&
      existing.status === 'scheduled' &&
      input.scheduledStartAt
    ) {
      updateData.startedAt = input.scheduledStartAt
    }
    if (input.impactOverride !== undefined) {
      updateData.impactOverride = existing.kind === 'incident' && input.impactOverride
    }
    const impactOverride =
      (updateData.impactOverride as boolean | undefined) ?? existing.impactOverride

    // A link to a service deleted since is history: it stays as it is, and a
    // stale editor that sends the deleted service back doesn't relink it.
    let previousLinks: { componentId: StatusComponentId; componentStatus: string }[] = []
    let nextComponents = input.affectedComponents
    let live = new Set<StatusComponentId>()
    if (input.affectedComponents !== undefined) {
      previousLinks = await tx.query.statusIncidentComponents.findMany({
        where: eq(statusIncidentComponents.incidentId, id),
      })
      live = await liveComponentIds(
        [
          ...new Set([
            ...previousLinks.map((link) => link.componentId),
            ...input.affectedComponents.map((c) => c.componentId),
          ]),
        ],
        tx
      )
      nextComponents = input.affectedComponents.filter((c) => live.has(c.componentId))
      // Every service sent has been deleted since the editor loaded: say so,
      // rather than that none was chosen.
      if (nextComponents.length === 0) {
        throw new ValidationError('VALIDATION_ERROR', DELETED_SERVICE_MESSAGE)
      }
      // Links to deleted services are kept either way, so only the live ones
      // can change: which services, and the status set on each. Of those,
      // only services every viewer of the page can see count: the stamp is
      // shared by every reader, so a change to a service gated to some
      // segments would tell everyone else that something they can't see
      // changed, and when.
      const seenByEveryone = new Set(
        (
          await tx
            .select({ id: statusComponents.id, segmentIds: statusComponents.segmentIds })
            .from(statusComponents)
            .where(inArray(statusComponents.id, [...live]))
        )
          .filter((component) => component.segmentIds.length === 0)
          .map((component) => component.id)
      )
      const before = new Map(
        previousLinks
          .filter((link) => seenByEveryone.has(link.componentId))
          .map((link) => [link.componentId, link.componentStatus])
      )
      const after = nextComponents.filter((c) => seenByEveryone.has(c.componentId))
      detailsChanged ||=
        after.length !== before.size ||
        after.some((c) => before.get(c.componentId) !== c.componentStatus)
    }
    // Stamped by the database's clock, the one that dates most updates, so
    // the feed's "edited after the latest update" never turns on clock skew.
    if (detailsChanged) updateData.detailsEditedAt = sql`now()`

    if (existing.kind === 'incident') {
      if (impactOverride && input.impact !== undefined) {
        updateData.impact = input.impact
      } else if (!impactOverride && nextComponents) {
        updateData.impact = deriveImpact(nextComponents.map((c) => c.componentStatus))
      }
    }

    await tx.update(statusIncidents).set(updateData).where(eq(statusIncidents.id, id))
    if (existing.kind === 'maintenance') await settleMaintenanceStart(id, tx)

    if (nextComponents === undefined) return existing
    const replaced = previousLinks
      .map((link) => link.componentId)
      .filter((componentId) => live.has(componentId))
    if (replaced.length > 0) {
      await tx
        .delete(statusIncidentComponents)
        .where(
          and(
            eq(statusIncidentComponents.incidentId, id),
            inArray(statusIncidentComponents.componentId, replaced)
          )
        )
    }
    await tx.insert(statusIncidentComponents).values(
      nextComponents.map((c) => ({
        incidentId: id,
        componentId: c.componentId,
        componentStatus: c.componentStatus,
      }))
    )

    // Apply the new/changed target statuses live, if this row is holding
    // its services: not a window still scheduled, a resolved incident or a
    // completed window, whose services may have been set by hand since.
    if (holdsComponents(existing.kind, existing.status)) {
      const source = existing.kind === 'incident' ? 'incident' : 'maintenance'
      const affected = new Set([
        ...replaced,
        ...nextComponents.map((component) => component.componentId),
      ])
      await reconcileComponentStatuses(affected, source, id, tx)
    }
    return existing
  })

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

export async function postIncidentUpdate(
  id: StatusIncidentId,
  input: PostIncidentUpdateInput,
  author: { principalId: PrincipalId | null }
): Promise<StatusIncidentWithDetails> {
  // A row's kind and whether it was backfilled never change, so the input is
  // checked against them before the transaction opens. Everything else is
  // decided from the row as locked inside it.
  const current = await requireIncident(id)
  const body = validateBody(input.body)
  assertStatusMatchesKind(current.kind, input.status)
  if (current.backfilled) assertBackfillStaysResolved(current.kind, input.status, true)

  const actor: EventActor = author.principalId
    ? buildEventActor({ principalId: author.principalId })
    : { type: 'service', displayName: 'system' }

  // The timeline row, the status change, the component statuses it moves and
  // the events announcing it commit together, so a failure part-way can't
  // leave an incident marked resolved while some of its services were never
  // restored, or a status that moved with no event to say so.
  const { existing, startsMaintenance, rearmsMaintenance, updateData } = await db.transaction(
    async (tx) => {
      const existing = await lockIncident(id, tx)

      const wasTerminal = existing.status === TERMINAL_STATUS[existing.kind]
      const becomesTerminal = input.status === TERMINAL_STATUS[existing.kind]
      // Moving a resolved incident or completed window back to an earlier
      // stage reopens it: clearing resolvedAt takes it out of resolved history
      // and puts it back in the open lists (and an incident in the public
      // active list), and it holds its services again. Resolving it later
      // stamps a fresh resolvedAt.
      const reopens = wasTerminal && !becomesTerminal
      // Posting 'in_progress' (or 'verifying') on a still-'scheduled' window
      // is a real start: record it in started_at, apply component statuses,
      // and re-arm the auto-complete job, the same effects as
      // handleMaintenanceStart but with the admin's own words as the single
      // timeline row instead of the scheduler's canned copy. The planned
      // window stays as planned, so the public page keeps showing it and
      // completion still fires at its end. A window the scheduler started
      // first is no longer scheduled here, so the post is a plain update.
      const startsMaintenance =
        existing.kind === 'maintenance' &&
        existing.status === 'scheduled' &&
        holdsComponents(existing.kind, input.status)
      const unschedulesMaintenance =
        existing.kind === 'maintenance' &&
        existing.status !== 'scheduled' &&
        input.status === 'scheduled'
      // A terminal update restores the services the row was holding, unless
      // the partial-recovery box was ticked; one that wasn't holding them (a
      // window completed before it started, a note on a resolved incident)
      // leaves them as they are. Any other move recomputes them only when it
      // changes whether the row holds them (a start, a reopen, a window moved
      // back to scheduled).
      const heldBefore = holdsComponents(existing.kind, existing.status)
      const recomputesComponents = becomesTerminal
        ? heldBefore && !input.skipRestore
        : heldBefore !== holdsComponents(existing.kind, input.status)

      const now = new Date()
      const updateData: Record<string, unknown> = { status: input.status, updatedAt: now }
      if (becomesTerminal && (!wasTerminal || !existing.resolvedAt)) {
        updateData.resolvedAt = now
      }
      if (reopens) {
        updateData.resolvedAt = null
      }
      if (startsMaintenance) {
        updateData.startedAt = now
      }
      // A window that isn't running holds its planned start in started_at.
      // Moved back to scheduled, it takes the plan again; completed straight
      // from scheduled, it keeps the plan as when it began (migration 0298
      // dates old rows the same way), unless the plan is still ahead: it
      // can't have started after it finished.
      if (unschedulesMaintenance && existing.scheduledStartAt) {
        updateData.startedAt = existing.scheduledStartAt
      }
      if (
        existing.kind === 'maintenance' &&
        existing.status === 'scheduled' &&
        becomesTerminal &&
        existing.startedAt > now
      ) {
        updateData.startedAt = now
      }
      // A window moved back across a boundary that has already passed would
      // be pushed straight forward again by the scheduler's sweep
      // (re-completed, or re-started). Switch that automation off; the admin
      // moves it on from the editor instead.
      if (existing.kind === 'maintenance' && (reopens || unschedulesMaintenance)) {
        if (existing.autoComplete && existing.scheduledEndAt && existing.scheduledEndAt <= now) {
          updateData.autoComplete = false
        }
        if (
          input.status === 'scheduled' &&
          existing.autoStart &&
          existing.scheduledStartAt &&
          existing.scheduledStartAt <= now
        ) {
          updateData.autoStart = false
        }
      }

      await tx.insert(statusIncidentUpdates).values({
        incidentId: id,
        status: input.status,
        body,
        createdBy: author.principalId,
        templateId: input.templateId ?? null,
        // A start is dated at the instant it records in started_at.
        ...(startsMaintenance ? { createdAt: now } : {}),
      })
      await tx.update(statusIncidents).set(updateData).where(eq(statusIncidents.id, id))
      if (existing.kind === 'maintenance') await settleMaintenanceStart(id, tx)

      if (recomputesComponents) {
        const links = await tx.query.statusIncidentComponents.findMany({
          where: eq(statusIncidentComponents.incidentId, id),
        })
        const source = existing.kind === 'incident' ? 'incident' : 'maintenance'
        await reconcileComponentStatuses(
          links.map((link) => link.componentId),
          source,
          id,
          tx
        )
      }

      await writeStatusEvent(
        'status.incident_updated',
        actor,
        { incidentId: id, kind: existing.kind, status: input.status, body },
        tx
      )
      // The window's own transition events, which the scheduler writes when it
      // makes the same move. Each path claims the move from the row's status
      // under the same lock, so a transition is announced once whoever made it.
      const completesMaintenance =
        existing.kind === 'maintenance' && becomesTerminal && !wasTerminal
      const transition = startsMaintenance
        ? 'status.maintenance_started'
        : completesMaintenance
          ? 'status.maintenance_completed'
          : null
      if (transition) {
        const links = await tx.query.statusIncidentComponents.findMany({
          where: eq(statusIncidentComponents.incidentId, id),
          columns: { componentId: true },
        })
        await writeStatusEvent(
          transition,
          actor,
          {
            incidentId: id,
            title: existing.title,
            componentIds: links.map((l) => l.componentId),
          },
          tx
        )
      }
      return {
        existing,
        startsMaintenance,
        rearmsMaintenance: existing.kind === 'maintenance' && (reopens || unschedulesMaintenance),
        updateData,
      }
    }
  )

  if (startsMaintenance) {
    await cancelMaintenanceJobs(existing).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to cancel maintenance jobs on manual start')
    )
    await enqueueMaintenanceJobs({ ...existing, status: input.status }).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to re-enqueue maintenance jobs on manual start')
    )
  } else if (rearmsMaintenance) {
    // Reopened or moved back: queue whichever boundaries are still ahead.
    await enqueueMaintenanceJobs({
      ...existing,
      ...(updateData as Partial<typeof existing>),
      status: input.status,
    }).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to re-enqueue maintenance jobs on reopen')
    )
  }

  return getStatusIncidentById(id)
}

/** Soft delete. Cancels any pending maintenance automation jobs and releases
 *  the services the incident was holding, if it was holding any. */
export async function deleteIncident(id: StatusIncidentId): Promise<void> {
  const existing = await requireIncident(id)

  if (existing.kind === 'maintenance') {
    await cancelMaintenanceJobs(existing).catch((err) =>
      log.error({ err, incident_id: id }, 'failed to cancel maintenance jobs on delete')
    )
  }

  await db.transaction(async (tx) => {
    const result = await tx
      .update(statusIncidents)
      .set({ deletedAt: new Date() })
      .where(and(eq(statusIncidents.id, id), isNull(statusIncidents.deletedAt)))
      .returning()

    const [deleted] = result
    if (!deleted) {
      throw new NotFoundError('STATUS_INCIDENT_NOT_FOUND', `Status incident ${id} not found`)
    }

    // A deleted incident no longer holds its services down: recompute each
    // one from whatever is still open (reconcile's active set skips deleted
    // rows), or an active incident's services would stay degraded forever.
    // A row that wasn't holding them (a window still scheduled, a resolved
    // incident, a completed window) leaves them as they are, so a status set
    // by hand or through the API since is kept. The delete locked the row,
    // so the status it returns is current (see lockIncident).
    if (!holdsComponents(deleted.kind, deleted.status)) return
    const links = await tx.query.statusIncidentComponents.findMany({
      where: eq(statusIncidentComponents.incidentId, id),
    })
    const source = deleted.kind === 'incident' ? 'incident' : 'maintenance'
    await reconcileComponentStatuses(
      links.map((link) => link.componentId),
      source,
      id,
      tx
    )
  })
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
    // A deleted service is off the page and out of the picker; leaving it out
    // here keeps the editor from resubmitting it on every autosave.
    .where(and(eq(statusIncidentComponents.incidentId, id), isNull(statusComponents.deletedAt)))

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
    notifySubscribers: incident.notifySubscribers,
    createdBy: incident.createdBy,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    affectedComponents: links,
    updates,
  }
}

/** Like getStatusIncidentById, but null for a deleted or unknown incident
 *  instead of a NotFoundError, for a reader that shows "not found" itself. */
export async function findStatusIncidentById(
  id: StatusIncidentId
): Promise<StatusIncidentWithDetails | null> {
  try {
    return await getStatusIncidentById(id)
  } catch (err) {
    if (err instanceof NotFoundError) return null
    throw err
  }
}

export async function listStatusIncidents(
  params: ListStatusIncidentsParams
): Promise<StatusIncidentListResult> {
  const { kind, state = 'all', statuses, order = 'newest', search, cursor, limit = 20 } = params
  const conditions = [isNull(statusIncidents.deletedAt)]
  if (kind) conditions.push(eq(statusIncidents.kind, kind))
  if (state === 'active') conditions.push(isNull(statusIncidents.resolvedAt))
  if (state === 'resolved') conditions.push(isNotNull(statusIncidents.resolvedAt))
  if (statuses) conditions.push(inArray(statusIncidents.status, statuses))
  const term = search?.trim()
  if (term) {
    const pattern = `%${term}%`
    // Title OR any update body — operators search for error codes and
    // phrases that only appear in updates, not titles.
    conditions.push(
      or(
        ilike(statusIncidents.title, pattern),
        // Raw names for the updates table: the relational query builder
        // below rewrites every column object onto the incidents alias.
        sql`EXISTS (
          SELECT 1 FROM status_incident_updates siu
          WHERE siu.incident_id = ${statusIncidents.id}
            AND siu.body ILIKE ${pattern}
        )`
      )!
    )
  }

  if (cursor) {
    // The cursor walks the newest-first order only.
    if (order !== 'newest') throw new Error('listStatusIncidents pages only newest first')
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
    orderBy:
      order === 'soonest'
        ? [sql`${statusIncidents.scheduledStartAt} asc nulls last`, asc(statusIncidents.id)]
        : [desc(statusIncidents.createdAt), desc(statusIncidents.id)],
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

type StatusIncidentRow = typeof statusIncidents.$inferSelect

/**
 * The creation event's type and payload for a published incident or
 * maintenance window. The payload says whether subscribers are emailed, which
 * is all the subscriber fan-out reads; webhooks and workflows get the event
 * either way.
 */
function statusPublishPayload(row: StatusIncidentRow, componentIds: string[]) {
  return {
    type: (row.kind === 'incident'
      ? 'status.incident_created'
      : 'status.maintenance_scheduled') as StatusIncidentPublishedType,
    data: {
      incident: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        status: row.status,
        impact: row.impact,
        scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null,
        scheduledEndAt: row.scheduledEndAt?.toISOString() ?? null,
        startedAt: row.startedAt.toISOString(),
        componentIds,
        notifySubscribers: row.notifySubscribers,
      },
    },
  }
}

type StatusIncidentPublishedType = 'status.incident_created' | 'status.maintenance_scheduled'

/** The creation event as an envelope, for writing on the caller's transaction. */
function statusPublishEvent(
  row: StatusIncidentRow,
  componentIds: string[],
  actor: EventActor
): EventData {
  const { type, data } = statusPublishPayload(row, componentIds)
  return {
    id: globalThis.crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    actor,
    data,
  } as unknown as EventData
}

/**
 * Announce a published incident/maintenance exactly once, for rows an older
 * version left unclaimed: createIncident now stamps `notified_at` and writes
 * the event itself. Atomically claims via `notified_at` in the same
 * transaction as the event, gated on `backfilled = false` so a backfilled row
 * can never be claimed (Status Product Spec §2), and on `notify_subscribers`
 * so a row published with "Email subscribers" unchecked is never claimed.
 */
export async function notifyStatusIncidentPublished(
  id: StatusIncidentId,
  actor: EventActor
): Promise<boolean> {
  try {
    // The claim and the event commit together: a failed write rolls the claim
    // back, so the row stays unclaimed for the sweep, and a claim that holds
    // always has its event.
    return await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(statusIncidents)
        .set({ notifiedAt: new Date() })
        .where(
          and(
            eq(statusIncidents.id, id),
            isNull(statusIncidents.notifiedAt),
            eq(statusIncidents.backfilled, false),
            eq(statusIncidents.notifySubscribers, true),
            isNull(statusIncidents.deletedAt)
          )
        )
        .returning()
      if (!claimed) return false

      const links = await tx.query.statusIncidentComponents.findMany({
        where: eq(statusIncidentComponents.incidentId, id),
        columns: { componentId: true },
      })
      const { writeEventToOutbox } = await import('@/lib/server/events/outbox-dispatch')
      await writeEventToOutbox(
        statusPublishEvent(
          claimed,
          links.map((l) => l.componentId),
          actor
        ),
        tx
      )
      return true
    })
  } catch (err) {
    log.error({ err, incident_id: id }, 'failed to dispatch status publish event')
    return false
  }
}

/** How old an unclaimed row must be before the sweep announces it. This
 *  version stamps a row in the transaction that inserts it, so the sweep only
 *  finds rows an older version left unclaimed. Leaving the newest alone also
 *  keeps it from racing a publish in flight: an older version publishing
 *  without the email inserts the row (notify_subscribers then defaults to
 *  true) and stamps notified_at a moment later. */
const NOTIFY_SWEEP_MIN_AGE_MS = 2 * 60 * 1000

/**
 * Safety net for publish notifications, mirroring
 * `reconcileChangelogNotifications`. Finds live, unclaimed, non-backfilled
 * incidents/maintenance whose publisher asked for the email, published at
 * least NOTIFY_SWEEP_MIN_AGE_MS ago, and announces each.
 */
export async function reconcileStatusNotifications(): Promise<number> {
  const due = await db
    .select({ id: statusIncidents.id, createdBy: statusIncidents.createdBy })
    .from(statusIncidents)
    .where(
      and(
        isNull(statusIncidents.notifiedAt),
        eq(statusIncidents.backfilled, false),
        eq(statusIncidents.notifySubscribers, true),
        isNull(statusIncidents.deletedAt),
        lte(statusIncidents.createdAt, new Date(Date.now() - NOTIFY_SWEEP_MIN_AGE_MS))
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
  row: typeof statusIncidentTemplates.$inferSelect,
  usageCount = 0
): StatusIncidentTemplateRow {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    body: row.body,
    impact: row.impact,
    componentIds: row.componentIds as StatusComponentId[],
    usageCount,
  }
}

export async function listStatusIncidentTemplates(): Promise<StatusIncidentTemplateRow[]> {
  const rows = await db.query.statusIncidentTemplates.findMany({
    orderBy: [asc(statusIncidentTemplates.name)],
  })

  // Derived usage: one update row per use, provenance survives edits and is
  // nulled on template delete, so counts can never drift.
  const usageRows = await db
    .select({
      templateId: statusIncidentUpdates.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(statusIncidentUpdates)
    .where(isNotNull(statusIncidentUpdates.templateId))
    .groupBy(statusIncidentUpdates.templateId)
  const usageByTemplate = new Map(usageRows.map((r) => [r.templateId, r.count]))

  // A template can still name a service deleted after it was saved. Offer
  // only the live ones, or applying it would submit a service that no longer
  // exists.
  const live = await liveComponentIds(
    [...new Set(rows.flatMap((r) => r.componentIds))] as StatusComponentId[],
    db
  )

  return rows.map((row) =>
    toTemplateRow(
      { ...row, componentIds: row.componentIds.filter((id) => live.has(id as StatusComponentId)) },
      usageByTemplate.get(row.id) ?? 0
    )
  )
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
