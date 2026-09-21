/**
 * The `events` queue handler — hook delivery, on Postgres.
 *
 * This is the body of what was the `{event-hooks}` BullMQ `Worker`, moved
 * verbatim in behaviour and split into its own module so `process.ts` is left
 * as the producer side alone.
 *
 * Four things about this queue are easy to lose in a move, and each has a
 * counterpart in `jobs/definitions.ts`:
 *
 * 1. **The retry curve is not geometric.** `retry-schedule.ts` runs two fast
 *    retries in seconds and then three jittered hourly ones, so an endpoint in
 *    a real outage still receives the delivery about seven hours later. A
 *    doubling curve from 5s would give up after 40 seconds. The definition
 *    carries `backoffMs: hookRetryDelayMs`.
 * 2. **Bulk enqueue must dedupe.** The relay re-drains a row after a crash and
 *    re-enqueues the same deterministic keys; `enqueueJobs` uses
 *    `ON CONFLICT DO NOTHING`, which is what makes delivery effectively-once.
 * 3. **Delayed jobs must be cancelable.** A changelog re-dated before it
 *    publishes has to un-schedule the old fire.
 * 4. **A permanent failure has a side effect.** The webhook failure counter
 *    auto-disables an endpoint at 50, and it must count only permanent
 *    failures — counting retries would disable a flaky endpoint after ~17
 *    events. That distinction is `onFailure`'s `permanent` argument.
 */
import { getHook } from './registry'
import { getIntegration } from '@/lib/server/integrations'
import { isRetryableError } from './hook-utils'
// Every module this handler reaches is imported statically, not at call time.
// The tier opens a workspace scope around every pass, so a deferred import would
// execute its target's top level under whichever workspace reached it first
// (`jobs/JOBS.md` §9); `__tests__/handler-imports.test.ts` enforces it.
import { db, webhooks, eq, sql } from '@/lib/server/db'
import { notifyChangelogPublished } from '@/lib/server/domains/changelog/changelog.service'
import {
  handleMaintenanceStart,
  handleMaintenanceComplete,
} from '@/lib/server/domains/status/status.maintenance'
import { checkPostForMergeCandidates } from '@/lib/server/domains/merge-suggestions/merge-check.service'
import { buildEventActor } from './dispatch'
import { TerminalJobError } from '@/lib/server/jobs/definitions'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { HookResult } from './hook-types'
import type { EventData } from './types'
import type { ChangelogId, PostId, PrincipalId, StatusIncidentId, WebhookId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'event-hook-job' })

export interface HookJobData {
  hookType: string
  event: EventData
  target: unknown
  config: Record<string, unknown>
}

/** Deliver one hook. */
export async function runHookJob(job: ClaimedJob): Promise<void> {
  const data = job.payload as unknown as HookJobData
  const { hookType, event, target, config: hookConfig } = data

  // Integration delivery belongs exclusively to the durable sync worker.
  // Enforce the queue boundary even if an invalid job is submitted.
  if (
    typeof hookConfig.integrationId === 'string' ||
    getIntegration(hookType) ||
    hookType === 'remote_status_push'
  ) {
    throw new TerminalJobError('Integration delivery requires the integration-sync queue')
  }

  // Handle delayed changelog publish sentinel
  if (hookType === '__changelog_publish__') {
    await handleDelayedChangelogPublish(hookConfig)
    return
  }

  // Handle post-merge recheck sentinel
  if (hookType === '__post_merge_recheck__') {
    await handlePostMergeRecheck(hookConfig)
    return
  }

  // Handle scheduled-maintenance window sentinels. Both handlers re-fetch
  // current DB state and self-guard, so a stale/duplicate fire is a no-op.
  if (hookType === '__status_maintenance_start__') {
    await handleStatusMaintenanceJob(hookConfig, 'start')
    return
  }
  if (hookType === '__status_maintenance_complete__') {
    await handleStatusMaintenanceJob(hookConfig, 'complete')
    return
  }

  const hook = await getHook(hookType)
  if (!hook) throw new TerminalJobError(`Unknown hook: ${hookType}`)

  // The idempotency handle handlers dedupe re-runs on. For a relay-enqueued
  // hook this is the deterministic `<eventId>:<sink>:<target>` key, which is
  // exactly what BullMQ's `job.id` carried; a job enqueued without one falls
  // back to its own branded id, which is still stable across attempts.
  const idempotencyKey = job.dedupeKey ?? job.jobId

  let result: HookResult
  try {
    result = await hook.run(event, target, hookConfig, { jobId: idempotencyKey })
  } catch (error) {
    if (isRetryableError(error)) throw error
    throw new TerminalJobError(error instanceof Error ? error.message : 'Unknown error')
  }

  if (result.success) return

  if (result.shouldRetry) {
    throw new Error(result.error ?? 'Hook failed (retryable)')
  }
  throw new TerminalJobError(result.error ?? 'Hook failed (non-retryable)')
}

/**
 * The `worker.on('failed')` side of the queue.
 *
 * `permanent` is the load-bearing argument: the webhook auto-disable counter
 * must move only when every attempt is spent, or a flaky endpoint disables
 * itself after roughly 17 events instead of 50.
 */
export async function onHookJobFailure(
  job: ClaimedJob,
  error: unknown,
  permanent: boolean
): Promise<void> {
  const data = job.payload as unknown as HookJobData
  log.error(
    {
      err: error,
      hook_type: data.hookType,
      event_id: data.event?.id,
      permanent,
      attempt: job.attempts,
    },
    'hook failed'
  )
  if (!permanent || data.hookType !== 'webhook') return
  await updateWebhookFailureCount(
    data,
    error instanceof Error ? error.message : String(error)
  ).catch((err) => log.error({ err }, 'failed to update webhook failure count'))
}

/**
 * Increment webhook failureCount and auto-disable after MAX_FAILURES.
 * Called only on permanent failure (all retries exhausted).
 */
async function updateWebhookFailureCount(data: HookJobData, errorMessage: string): Promise<void> {
  const webhookId = (data.config as { webhookId?: WebhookId }).webhookId
  if (!webhookId) return

  const MAX_FAILURES = 50

  await db
    .update(webhooks)
    .set({
      failureCount: sql`${webhooks.failureCount} + 1`,
      lastTriggeredAt: new Date(),
      lastError: errorMessage,
      status: sql`CASE WHEN ${webhooks.failureCount} + 1 >= ${MAX_FAILURES} THEN 'disabled' ELSE ${webhooks.status} END`,
    })
    .where(eq(webhooks.id, webhookId))
}

/**
 * Handle a delayed changelog publish job. A thin trigger: the service helper's
 * atomic claim handles eligibility (published, not future-dated, not deleted)
 * and the notify-once guarantee, so a lost or duplicated job can't double-send.
 */
async function handleDelayedChangelogPublish(hookConfig: Record<string, unknown>): Promise<void> {
  const changelogId = hookConfig.changelogId as string | undefined
  const principalId = hookConfig.principalId as string | undefined
  // Defaults true so a job scheduled before this field existed still sends.
  const notify = hookConfig.notify !== false
  if (!changelogId) return

  const actor = principalId
    ? buildEventActor({ principalId: principalId as PrincipalId })
    : { type: 'service' as const, displayName: 'scheduler' }

  await notifyChangelogPublished(changelogId as ChangelogId, actor, notify)
}

/**
 * Handle a scheduled-maintenance window boundary job (auto-start / auto-complete).
 * The handlers re-fetch DB state and guard on current status, so a stale job
 * left by a reschedule, or a duplicate, is a harmless no-op.
 */
async function handleStatusMaintenanceJob(
  hookConfig: Record<string, unknown>,
  phase: 'start' | 'complete'
): Promise<void> {
  const incidentId = hookConfig.incidentId as string | undefined
  if (!incidentId) return

  const id = incidentId as StatusIncidentId
  if (phase === 'start') {
    await handleMaintenanceStart(id)
  } else {
    await handleMaintenanceComplete(id)
  }
}

/**
 * Handle a post-merge recheck job.
 * Re-checks the canonical post for additional duplicate candidates.
 */
async function handlePostMergeRecheck(hookConfig: Record<string, unknown>): Promise<void> {
  const postId = hookConfig.postId as string | undefined
  if (!postId) return

  await checkPostForMergeCandidates(postId as PostId)
  log.debug({ post_id: postId }, 'post-merge recheck complete')
}
