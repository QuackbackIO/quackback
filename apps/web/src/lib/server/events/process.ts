/**
 * Event processing — resolves targets and enqueues hooks via BullMQ.
 *
 * Hooks are executed by a BullMQ Worker with retry and persistence.
 * Failed hooks are stored in the BullMQ failed job set (queryable).
 */

import { Queue, Worker, UnrecoverableError } from 'bullmq'
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
  const connOpts = { url: config.redisUrl, maxRetriesPerRequest: null as null }

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
      const hook = getHook(hookType)
      if (!hook) throw new UnrecoverableError(`Unknown hook: ${hookType}`)

      let result: HookResult
      try {
        result = await hook.run(event, target, hookConfig)
      } catch (error) {
        if (isRetryableError(error)) throw error
        throw new UnrecoverableError(error instanceof Error ? error.message : 'Unknown error')
      }

      if (result.success) return

      if (result.shouldRetry) {
        throw new Error(result.error ?? 'Hook failed (retryable)')
      }
      throw new UnrecoverableError(result.error ?? 'Hook failed (non-retryable)')
    },
    { connection: connOpts, concurrency: CONCURRENCY }
  )

  worker.on('failed', (job, error) => {
    if (!job) return
    const isPermanent = job.attemptsMade >= (job.opts.attempts ?? 1)
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
 * Called on SIGTERM and in test cleanup.
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

// Graceful shutdown — BullMQ leaves jobs in limbo on unclean exit.
// Sets exitCode instead of calling process.exit() to let the framework
// finish its own cleanup (e.g. TanStack Start shutdown hooks).
function handleShutdown(signal: string) {
  console.log(`[Event] ${signal} received, closing queue...`)
  const timeout = setTimeout(() => {
    console.error('[Event] Shutdown timed out after 10s, forcing exit')
    process.exitCode = 1
  }, 10_000)
  closeQueue()
    .catch((err) => console.error('[Event] Shutdown error:', err))
    .finally(() => clearTimeout(timeout))
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))
