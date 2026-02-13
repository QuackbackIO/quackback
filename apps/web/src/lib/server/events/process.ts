/**
 * Event processing — resolves targets and enqueues hooks via BullMQ.
 *
 * Hooks are executed by a BullMQ Worker with retry and persistence.
 * Failed hooks are stored in the BullMQ failed job set (queryable).
 */

import { Queue, Worker, UnrecoverableError, type JobsOptions } from 'bullmq'
import { config } from '@/lib/server/config'
import { getHook } from './registry'
import { getHookTargets } from './targets'
import { isRetryableError } from './hook-utils'
import type { HookResult } from './hook-types'
import type { EventData } from './types'
import type { WebhookId } from '@quackback/ids'

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
  removeOnComplete: true, // no dashboard yet — remove immediately
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
  const connOpts = {
    url: config.redisUrl,
    maxRetriesPerRequest: null as null,
    connectTimeout: 5_000,
  }

  // Separate connections: BullMQ Workers use blocking commands (BLMOVE)
  // that conflict with Queue commands on a shared connection.
  const queue = new Queue<HookJobData>(QUEUE_NAME, {
    connection: connOpts,
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

      const hook = getHook(hookType)
      if (!hook) throw new UnrecoverableError(`Unknown hook: ${hookType}`)

      let result: HookResult
      try {
        result = await hook.run(event, target, hookConfig)
      } catch (error) {
        if (isRetryableError(error)) throw error
        throw new UnrecoverableError(error instanceof Error ? error.message : 'Unknown error')
      }

      if (result.success) {
        if (result.externalId) {
          persistExternalLink(job.data, result).catch((err) =>
            console.error('[Event] Failed to persist external link:', err)
          )
        }
        return
      }

      if (result.shouldRetry) {
        throw new Error(result.error ?? 'Hook failed (retryable)')
      }
      throw new UnrecoverableError(result.error ?? 'Hook failed (non-retryable)')
    },
    { connection: connOpts, concurrency: CONCURRENCY }
  )

  // Verify Redis is reachable before returning. Without this, a missing
  // Redis hangs every request that dispatches events (post/comment creation).
  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), 5_000)
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
    const prefix = isPermanent ? 'permanently failed' : `failed (attempt ${job.attemptsMade})`
    console.error(
      `[Event] ${job.data.hookType} ${prefix} for event ${job.data.event.id}: ${error.message}`
    )

    // Webhook failure counting: only on permanent failure.
    // Avoids inflating failureCount during retries (which would hit
    // auto-disable threshold after ~17 flaky events instead of 50).
    if (isPermanent && job.data.hookType === 'webhook') {
      updateWebhookFailureCount(job.data, error.message).catch((err) =>
        console.error('[Event] Failed to update webhook failure count:', err)
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
      externalUrl: result.externalUrl ?? null,
    })
    .onConflictDoNothing()
}

/**
 * Process an event by resolving targets and enqueuing hooks.
 * Target resolution is awaited (~10-50ms). Hook execution runs in the background.
 */
export async function processEvent(event: EventData): Promise<void> {
  const targets = await getHookTargets(event)
  if (targets.length === 0) return

  console.log(`[Event] Processing ${event.type} event ${event.id} (${targets.length} targets)`)

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
    console.error('[Event] Worker close error:', e)
  }
  try {
    await queue.close()
  } catch (e) {
    console.error('[Event] Queue close error:', e)
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
    removeOnComplete: true,
    removeOnFail: true,
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
      console.log(`[Event] Removed delayed job ${jobId}`)
    }
  } catch {
    // Job may have already been processed or removed
  }
}

/**
 * Handle a delayed changelog publish job.
 * Re-fetches the entry from DB to verify it's still published before dispatching.
 */
async function handleDelayedChangelogPublish(hookConfig: Record<string, unknown>): Promise<void> {
  const changelogId = hookConfig.changelogId as string | undefined
  const principalId = hookConfig.principalId as string | undefined
  if (!changelogId) return

  const { db, changelogEntries, eq } = await import('@/lib/server/db')
  const entry = await db.query.changelogEntries.findFirst({
    where: eq(changelogEntries.id, changelogId as import('@quackback/ids').ChangelogId),
  })

  if (!entry || !entry.publishedAt || entry.publishedAt > new Date()) {
    console.log(
      `[Event] Skipping delayed changelog publish for ${changelogId} — no longer published`
    )
    return
  }

  // Count linked posts
  const { changelogEntryPosts } = await import('@/lib/server/db')
  const linkedPosts = await db.query.changelogEntryPosts.findMany({
    where: eq(
      changelogEntryPosts.changelogEntryId,
      changelogId as import('@quackback/ids').ChangelogId
    ),
    columns: { postId: true },
  })

  const { buildEventActor, dispatchChangelogPublished } = await import('./dispatch')

  const actor = principalId
    ? buildEventActor({ principalId: principalId as import('@quackback/ids').PrincipalId })
    : { type: 'service' as const, displayName: 'scheduler' }

  await dispatchChangelogPublished(actor, {
    id: entry.id,
    title: entry.title,
    contentPreview: entry.content.slice(0, 200),
    publishedAt: entry.publishedAt,
    linkedPostCount: linkedPosts.length,
  })
}
