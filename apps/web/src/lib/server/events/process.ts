/**
 * Event processing — resolves targets and enqueues hooks via BullMQ.
 *
 * Hooks are executed by a BullMQ Worker with retry and persistence.
 * Failed hooks are stored in the BullMQ failed job set (queryable).
 */

import { Queue, Worker, UnrecoverableError, type JobsOptions } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { getHook } from './registry'
import { getHookTargets } from './targets'
import { isRetryableError } from './hook-utils'
import type { HookResult } from './hook-types'
import type { EventData } from './types'
import type { WebhookId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'event-process' })

interface HookJobData {
  hookType: string
  event: EventData
  target: unknown
  config: Record<string, unknown>
}

// Hashtag pins all keys to a single Dragonfly thread for Lua script compat.
// See: https://www.dragonflydb.io/docs/integrations/bullmq
const QUEUE_NAME = '{event-hooks}'

// Webhook handlers do DNS + HTTP with a 5s timeout. 5 concurrent workers
// keeps outbound connections reasonable on modest hardware while still
// processing events promptly. Increase if throughput demands it.
const CONCURRENCY = 5

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  // Keep last 1000 completed jobs (or 24h, whichever first) for
  // operational visibility. `true` (immediate purge) makes Bull Board
  // / `redis-cli LRANGE` useless for diagnosing "did this webhook
  // actually fire?" questions and gives us nothing on disk to inspect
  // when a customer reports a missed delivery.
  removeOnComplete: { count: 1000, age: 86400 },
  removeOnFail: { age: 30 * 86400 }, // keep failed jobs 30 days
}

let initPromise: Promise<{
  queue: Queue<HookJobData>
  worker: Worker<HookJobData>
}> | null = null

/**
 * Lazily initialize BullMQ queue and worker.
 * Uses a Promise to guard against concurrent first-call race conditions.
 * Resets on failure so transient errors don't permanently break the queue.
 */
function ensureQueue(): Promise<Queue<HookJobData>> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise.then(({ queue }) => queue)
}

async function initializeQueue() {
  const connection = getQueueRedis()

  // BullMQ duplicates this client internally for the Worker's blocking
  // commands (BLMOVE), so a single shared connection is safe and avoids
  // opening N TCP sockets per queue.
  const queue = new Queue<HookJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<HookJobData>(
    QUEUE_NAME,
    async (job) => {
      const { hookType, event, target, config: hookConfig } = job.data

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

      const hook = await getHook(hookType)
      if (!hook) throw new UnrecoverableError(`Unknown hook: ${hookType}`)

      let result: HookResult
      try {
        // Pass job.id so idempotency-sensitive handlers (webhook, AI)
        // can dedupe re-runs after worker crashes.
        result = await hook.run(event, target, hookConfig, { jobId: job.id })
      } catch (error) {
        if (isRetryableError(error)) throw error
        throw new UnrecoverableError(error instanceof Error ? error.message : 'Unknown error')
      }

      if (result.success) {
        if (result.externalId) {
          persistExternalLink(job.data, result).catch((err) =>
            log.error({ err }, 'failed to persist external link')
          )
        }
        return
      }

      if (result.shouldRetry) {
        throw new Error(result.error ?? 'Hook failed (retryable)')
      }
      throw new UnrecoverableError(result.error ?? 'Hook failed (non-retryable)')
    },
    { connection, concurrency: CONCURRENCY }
  )

  // Verify Redis is reachable before returning. Without this, a missing
  // Redis hangs every request that dispatches events (post/comment creation).
  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), REDIS_READY_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    await queue.close().catch(() => {})
    await worker.close().catch(() => {})
    throw error
  }

  worker.on('failed', (job, error) => {
    if (!job) return
    // UnrecoverableError skips retries entirely (attemptsMade stays at 1),
    // so we must also check the error name to detect permanent failure.
    const isPermanent =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'UnrecoverableError'
    log.error(
      {
        err: error,
        hook_type: job.data.hookType,
        event_id: job.data.event.id,
        permanent: isPermanent,
        attempt: job.attemptsMade,
      },
      'hook failed'
    )

    // Webhook failure counting: only on permanent failure.
    // Avoids inflating failureCount during retries (which would hit
    // auto-disable threshold after ~17 flaky events instead of 50).
    if (isPermanent && job.data.hookType === 'webhook') {
      updateWebhookFailureCount(job.data, error.message).catch((err) =>
        log.error({ err }, 'failed to update webhook failure count')
      )
    }
  })

  return { queue, worker }
}

/**
 * Increment webhook failureCount and auto-disable after MAX_FAILURES.
 * Called only on permanent failure (all retries exhausted).
 */
async function updateWebhookFailureCount(data: HookJobData, errorMessage: string): Promise<void> {
  const webhookId = (data.config as { webhookId?: WebhookId }).webhookId
  if (!webhookId) return

  const { db, webhooks, eq, sql } = await import('@/lib/server/db')
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
 * Persist an external link when an outbound hook successfully creates an external issue.
 * Non-fatal — errors are logged but don't fail the hook job.
 */
async function persistExternalLink(data: HookJobData, result: HookResult): Promise<void> {
  // Extract postId from event data
  const postId = (data.event.data as { post?: { id?: string } }).post?.id
  if (!postId) return

  const { db, integrations, postExternalLinks, eq } = await import('@/lib/server/db')

  // Look up the integration by type
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, data.hookType),
    columns: { id: true },
  })
  if (!integration) return

  await db
    .insert(postExternalLinks)
    .values({
      postId: postId as import('@quackback/ids').PostId,
      integrationId: integration.id as import('@quackback/ids').IntegrationId,
      integrationType: data.hookType,
      externalId: result.externalId!,
      externalDisplayId: result.externalDisplayId ?? null,
      externalUrl: result.externalUrl ?? null,
    })
    .onConflictDoNothing()
}

/**
 * Process an event by resolving targets and enqueuing hooks.
 * Target resolution is awaited (~10-50ms). Hook execution runs in the background.
 */
export async function processEvent(event: EventData): Promise<void> {
  // Fire workflow triggers off the same event (§4.6). Fire-and-forget + fully
  // error-isolated, and BEFORE the no-hook-targets early return so a workflow
  // still runs when there are no webhook/notification subscribers. Lazily
  // imported so the event core carries no static dependency on the workflow
  // engine (a workflow fault stays isolated to this branch).
  void import('@/lib/server/domains/workflows/event-trigger')
    .then((m) => m.dispatchWorkflowsForEvent(event))
    .catch((err) => log.error({ err, event_type: event.type }, 'workflow dispatch failed to load'))

  // Settle SLA breach clocks off the same event (first-response / time-to-close).
  // Same fire-and-forget + lazy-import isolation as the workflow dispatch.
  void import('@/lib/server/domains/sla/sla.event-hooks')
    .then((m) => m.recordSlaFromEvent(event))
    .catch((err) => log.error({ err, event_type: event.type }, 'SLA hook failed to load'))

  const targets = await getHookTargets(event)
  if (targets.length === 0) return

  log.debug(
    { event_type: event.type, event_id: event.id, target_count: targets.length },
    'processing event'
  )

  const queue = await ensureQueue()

  await queue.addBulk(
    targets.map(({ type, target, config: hookConfig }) => ({
      name: `${event.type}:${type}`,
      data: { hookType: type, event, target, config: hookConfig },
    }))
  )
}

/**
 * Gracefully shut down the queue and worker.
 * Called in test cleanup. In production, BullMQ's stalled job checker
 * recovers any in-flight jobs on next startup if the process exits uncleanly.
 */
export async function closeQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null

  try {
    await worker.close()
  } catch (e) {
    log.error({ err: e }, 'worker close error')
  }
  try {
    await queue.close()
  } catch (e) {
    log.error({ err: e }, 'queue close error')
  }
}

// ============================================================================
// Delayed Job Helpers
// ============================================================================

/**
 * Add a delayed job to the event queue.
 * Used for scheduled changelog publishing and similar deferred work.
 */
export async function addDelayedJob(
  name: string,
  data: HookJobData,
  opts?: JobsOptions
): Promise<void> {
  const queue = await ensureQueue()
  await queue.add(name, data, {
    ...opts,
    // Bounded retention rather than immediate purge, matching the
    // queue's defaultJobOptions. Delayed jobs are rare but worth
    // surfacing in `redis-cli LRANGE` when one mis-fires.
    removeOnComplete: { count: 1000, age: 86400 },
    removeOnFail: { age: 30 * 86400 },
  })
}

/**
 * Remove a delayed job by its ID.
 * Returns silently if the job doesn't exist (already executed or was never created).
 */
export async function removeDelayedJob(jobId: string): Promise<void> {
  const queue = await ensureQueue()
  try {
    const job = await queue.getJob(jobId)
    if (job) {
      await job.remove()
      log.debug({ job_id: jobId }, 'removed delayed job')
    }
  } catch {
    // Job may have already been processed or removed
  }
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

  const { notifyChangelogPublished } =
    await import('@/lib/server/domains/changelog/changelog.service')
  const { buildEventActor } = await import('./dispatch')

  const actor = principalId
    ? buildEventActor({ principalId: principalId as import('@quackback/ids').PrincipalId })
    : { type: 'service' as const, displayName: 'scheduler' }

  await notifyChangelogPublished(changelogId as import('@quackback/ids').ChangelogId, actor, notify)
}

/**
 * Handle a post-merge recheck job.
 * Re-checks the canonical post for additional duplicate candidates.
 */
async function handlePostMergeRecheck(hookConfig: Record<string, unknown>): Promise<void> {
  const postId = hookConfig.postId as string | undefined
  if (!postId) return

  const { checkPostForMergeCandidates } =
    await import('@/lib/server/domains/merge-suggestions/merge-check.service')
  await checkPostForMergeCandidates(postId as import('@quackback/ids').PostId)
  log.debug({ post_id: postId }, 'post-merge recheck complete')
}
