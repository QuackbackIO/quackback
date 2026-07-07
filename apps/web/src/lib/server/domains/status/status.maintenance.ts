/**
 * Scheduled maintenance window automation (Status Product Spec §9). Mirrors
 * the changelog scheduled-publish delayed-job pattern (events/scheduler.ts):
 * a BullMQ job fires at the window boundary, and the handler re-fetches
 * current DB state before acting so a stale/duplicate fire (a reschedule
 * left an old job queued, or the reconcile sweep races a live job) is a
 * harmless no-op rather than a double-transition.
 *
 * Depends only on status.components.ts (no cycle with status.service.ts,
 * which calls into this module after creating/updating an incident).
 */
import {
  db,
  eq,
  and,
  isNull,
  lte,
  or,
  statusIncidents,
  statusIncidentComponents,
  statusIncidentUpdates,
} from '@/lib/server/db'
import type { StatusIncidentId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { scheduleDispatch, cancelScheduledDispatch } from '@/lib/server/events/scheduler'
import type { EventActor } from '@/lib/server/events/dispatch'
import { setComponentStatus, dispatchStatusEvent } from './status.components'

const log = logger.child({ component: 'status-maintenance' })

const SCHEDULER_ACTOR: EventActor = { type: 'service', displayName: 'status-maintenance-scheduler' }

type MaintenanceScheduleFields = {
  id: StatusIncidentId
  kind: string
  status: string
  scheduledStartAt: Date | null
  scheduledEndAt: Date | null
  autoStart: boolean
  autoComplete: boolean
}

/** Included in the job id so a reschedule (either bound changing) produces a
 *  fresh id — the stale job for the old time, if it still fires, is a no-op
 *  once the handler re-checks current state (see module docblock). */
function scheduleHash(
  incident: Pick<MaintenanceScheduleFields, 'scheduledStartAt' | 'scheduledEndAt'>
): string {
  const start = incident.scheduledStartAt?.getTime() ?? 'none'
  const end = incident.scheduledEndAt?.getTime() ?? 'none'
  return `${start}-${end}`
}

function startJobId(incidentId: StatusIncidentId, hash: string): string {
  return `status-maintenance-start--${incidentId}--${hash}`
}
function completeJobId(incidentId: StatusIncidentId, hash: string): string {
  return `status-maintenance-complete--${incidentId}--${hash}`
}

/** Enqueue (or re-enqueue) the delayed start/complete jobs for a maintenance
 *  window. No-op for kind='incident' or once a bound has already passed. */
export async function enqueueMaintenanceJobs(incident: MaintenanceScheduleFields): Promise<void> {
  if (incident.kind !== 'maintenance') return
  const hash = scheduleHash(incident)
  const now = Date.now()

  if (incident.autoStart && incident.status === 'scheduled' && incident.scheduledStartAt) {
    const delayMs = incident.scheduledStartAt.getTime() - now
    if (delayMs > 0) {
      await scheduleDispatch({
        jobId: startJobId(incident.id, hash),
        handler: '__status_maintenance_start__',
        delayMs,
        payload: { incidentId: incident.id },
        actor: SCHEDULER_ACTOR,
      })
    }
  }

  if (
    incident.autoComplete &&
    incident.scheduledEndAt &&
    incident.status !== 'completed' &&
    incident.status !== 'resolved'
  ) {
    const delayMs = incident.scheduledEndAt.getTime() - now
    if (delayMs > 0) {
      await scheduleDispatch({
        jobId: completeJobId(incident.id, hash),
        handler: '__status_maintenance_complete__',
        delayMs,
        payload: { incidentId: incident.id },
        actor: SCHEDULER_ACTOR,
      })
    }
  }
}

/** Best-effort cancel of the current schedule's jobs (e.g. on delete). Any
 *  earlier-hash job left over from a prior reschedule self-guards on fire. */
export async function cancelMaintenanceJobs(incident: MaintenanceScheduleFields): Promise<void> {
  if (incident.kind !== 'maintenance') return
  const hash = scheduleHash(incident)
  await cancelScheduledDispatch(startJobId(incident.id, hash))
  await cancelScheduledDispatch(completeJobId(incident.id, hash))
}

async function affectedComponentIds(incidentId: StatusIncidentId) {
  const links = await db.query.statusIncidentComponents.findMany({
    where: eq(statusIncidentComponents.incidentId, incidentId),
  })
  return links
}

/** Flip a scheduled window to in_progress + apply component statuses. Guarded
 *  on status==='scheduled' so a stale duplicate job is a no-op. */
export async function handleMaintenanceStart(incidentId: StatusIncidentId): Promise<void> {
  const incident = await db.query.statusIncidents.findFirst({
    where: and(eq(statusIncidents.id, incidentId), isNull(statusIncidents.deletedAt)),
  })
  if (!incident || incident.kind !== 'maintenance' || incident.status !== 'scheduled') return

  await db
    .update(statusIncidents)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(statusIncidents.id, incidentId))

  const links = await affectedComponentIds(incidentId)
  for (const link of links) {
    await setComponentStatus(link.componentId, link.componentStatus, 'maintenance', incidentId)
  }

  await db.insert(statusIncidentUpdates).values({
    incidentId,
    status: 'in_progress',
    body: 'This scheduled maintenance is now in progress.',
    createdBy: null,
  })

  await dispatchStatusEvent('status.maintenance_started', SCHEDULER_ACTOR, {
    incidentId,
    title: incident.title,
    componentIds: links.map((l) => l.componentId),
  }).catch((err) =>
    log.error({ err, incident_id: incidentId }, 'failed to dispatch status.maintenance_started')
  )
}

/** Flip a window to completed + restore affected components to operational.
 *  Guarded on status!=='completed' so a stale duplicate job is a no-op; also
 *  the reconcile sweep's catch-up path for a window whose start was missed
 *  entirely (still 'scheduled') during downtime. */
export async function handleMaintenanceComplete(incidentId: StatusIncidentId): Promise<void> {
  const incident = await db.query.statusIncidents.findFirst({
    where: and(eq(statusIncidents.id, incidentId), isNull(statusIncidents.deletedAt)),
  })
  if (!incident || incident.kind !== 'maintenance' || incident.status === 'completed') return

  await db
    .update(statusIncidents)
    .set({
      status: 'completed',
      resolvedAt: incident.resolvedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(statusIncidents.id, incidentId))

  const links = await affectedComponentIds(incidentId)
  for (const link of links) {
    await setComponentStatus(link.componentId, 'operational', 'maintenance', incidentId)
  }

  await db.insert(statusIncidentUpdates).values({
    incidentId,
    status: 'completed',
    body: 'This scheduled maintenance is complete.',
    createdBy: null,
  })

  await dispatchStatusEvent('status.maintenance_completed', SCHEDULER_ACTOR, {
    incidentId,
    title: incident.title,
    componentIds: links.map((l) => l.componentId),
  }).catch((err) =>
    log.error({ err, incident_id: incidentId }, 'failed to dispatch status.maintenance_completed')
  )
}

/**
 * Boot-time safety net for maintenance windows missed while the process was
 * down (a delayed BullMQ job only fires if something is listening). Finds
 * overdue scheduled starts and overdue completions and runs each handler,
 * which is idempotent via the guards above.
 */
export async function reconcileMaintenanceWindows(): Promise<{
  started: number
  completed: number
}> {
  const now = new Date()
  const due = await db.query.statusIncidents.findMany({
    where: and(
      eq(statusIncidents.kind, 'maintenance'),
      isNull(statusIncidents.deletedAt),
      or(
        and(
          eq(statusIncidents.status, 'scheduled'),
          eq(statusIncidents.autoStart, true),
          lte(statusIncidents.scheduledStartAt, now)
        ),
        and(eq(statusIncidents.autoComplete, true), lte(statusIncidents.scheduledEndAt, now))
      )
    ),
  })

  let started = 0
  let completed = 0
  for (const incident of due) {
    if (
      incident.status === 'scheduled' &&
      incident.autoStart &&
      incident.scheduledStartAt &&
      incident.scheduledStartAt <= now
    ) {
      await handleMaintenanceStart(incident.id)
      started++
    }
    if (
      incident.status !== 'completed' &&
      incident.autoComplete &&
      incident.scheduledEndAt &&
      incident.scheduledEndAt <= now
    ) {
      await handleMaintenanceComplete(incident.id)
      completed++
    }
  }
  return { started, completed }
}
