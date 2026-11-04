/**
 * The mail provider tenant reconcile, as a job (see `ses-tenant-reconcile.ts`).
 * Schedule and retry policy live in `jobs/definitions.ts`.
 *
 * The hourly tick reconciles a workspace only when it has never been
 * reconciled, is not ready yet, uses a different configuration set than the
 * one associated, or was last reconciled a day ago. So a new deployment
 * backfills every workspace within the hour, a workspace that fell short is
 * retried within the hour, and a ready one is refreshed daily. On-demand runs
 * (after a sending domain is added, goes live or is removed) always reconcile.
 */
import { sesTenantsEnabled } from '@quackback/email/ses-tenant'
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { reconcileSesTenant } from './ses-tenant-reconcile'
import { getSesTenantState, sesTenantName } from './ses-tenant-state'

const log = logger.child({ component: 'ses-tenant-reconcile' })

export const SES_TENANT_QUEUE = 'ses-tenant-reconcile'

/** How long a ready tenant goes before it is reconciled again. */
export const SES_TENANT_REFRESH_MS = 23 * 60 * 60 * 1000

/** Whether the schedule runs at all: only when the operator turned tenants on. */
export async function sesTenantReconcileEnabled(): Promise<boolean> {
  return sesTenantsEnabled()
}

/** Whether the scheduled tick should reconcile this workspace now. */
export async function sesTenantReconcileDue(now: Date = new Date()): Promise<boolean> {
  const name = sesTenantName()
  if (!name) return false
  const state = await getSesTenantState(name)
  if (!state?.readyAt || !state.reconciledAt) return true
  if (state.configurationSet !== process.env.EMAIL_SES_CONFIGURATION_SET?.trim()) return true
  return now.getTime() - state.reconciledAt.getTime() >= SES_TENANT_REFRESH_MS
}

export async function runSesTenantReconcile(job: ClaimedJob): Promise<void> {
  const onDemand = job.payload?.onDemand === true
  if (!onDemand && !(await sesTenantReconcileDue())) return
  const result = await reconcileSesTenant()
  // A provider failure is retried with backoff; a run that completed but is not
  // ready (no verified platform identity, say) is a state, not a failure.
  if (!result.skipped && result.errors.length > 0) {
    throw new Error(`ses tenant reconcile incomplete: ${result.errors[0]}`)
  }
}

/**
 * Ask for a reconcile soon, from a request or another job. Never blocks on the
 * provider and never throws: the hourly tick catches anything this misses.
 */
export async function enqueueSesTenantReconcile(reason: string): Promise<void> {
  if (!sesTenantsEnabled()) return
  try {
    await enqueueJob({ queue: SES_TENANT_QUEUE, payload: { onDemand: true, reason }, maxAttempts: 3 })
  } catch (err) {
    log.warn({ err, reason }, 'ses tenant reconcile could not be enqueued')
  }
}
