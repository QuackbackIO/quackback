---
title: 'feat: Add background processing and retry with BullMQ + Dragonfly'
type: feat
date: 2026-02-07
---

# Background Processing and Retry with BullMQ + Dragonfly

## Overview

Replace `Promise.allSettled` in `process.ts` with BullMQ for persistent background job processing. Add Dragonfly (Redis-compatible, ~50MB) to docker-compose. BullMQ provides retry with exponential backoff, failed job storage, persistence across crashes, and concurrency control — no custom retry loops, dead letter tables, or migrations needed.

## Problem Statement

1. **Blocking requests**: Hook execution runs inline and blocks the HTTP response.
2. **No retries**: `shouldRetry` exists on `HookResult` but nothing consumes it.
3. **No failure visibility**: Only `console.error`. No queryable record.
4. **Lost on crash**: In-memory processing, all in-flight hooks lost on restart.

## Proposed Solution

A BullMQ `Worker` processes jobs by calling `hook.run()`, translating `HookResult` into BullMQ semantics:

- **Return normally** → job complete
- **Throw `Error`** → BullMQ retries with exponential backoff
- **Throw `UnrecoverableError`** → immediate permanent failure, no retry

Target resolution stays synchronous (~10-50ms DB query); only hook _execution_ moves to background. `REDIS_URL` is required — Dragonfly is included in docker-compose.

```
dispatch.ts → processEvent() → resolve targets (awaited, ~10-50ms)
                                    → queue.add() per target → return
                                               ↓ (background, persistent in Dragonfly)
                                        Worker: hook.run()
                                               ↓ (on failure)
                                        BullMQ retry (3 attempts, exponential backoff)
                                               ↓ (if exhausted or non-retryable)
                                        Failed job set (queryable, 30-day retention)
```

### Design Decisions

1. **BullMQ directly, no abstraction** — Used directly in `process.ts`. No wrapper. Refactor this one file when requirements change.

2. **Dragonfly over Redis** — Redis-compatible, ~50MB footprint, single binary. Self-hosters can swap for Redis (same `REDIS_URL`).

3. **`shouldRetry: undefined` defaults to `false`** — Conservative: only hooks that explicitly opt in get retried. Non-retryable failures wrapped in `UnrecoverableError`.

4. **Thrown exceptions use `isRetryableError()`** — A `TypeError` from a malformed target should not retry 3 times. Only network/rate-limit errors retry.

5. **`REDIS_URL` is required** — No inline fallback. Dragonfly is in docker-compose and `bun run setup` starts it.

6. **Separate connections for Queue and Worker** — BullMQ Workers use blocking Redis commands (`BLMOVE`). Sharing one connection between Queue and Worker causes conflicts. Pass connection _options_ so BullMQ creates separate connections internally.

7. **Webhook failure counting on final failure only** — Instead of counting failures inside the webhook handler (inflated by retries), the BullMQ `worker.on('failed')` callback handles it — fires once when all retries are exhausted. No `countFailure` boolean parameter needed.

## Infrastructure

### `docker-compose.yml` — Add Dragonfly

```yaml
dragonfly:
  image: docker.dragonflydb.io/dragonflydb/dragonfly:v1.27.1
  container_name: quackback-dragonfly
  restart: unless-stopped
  ports:
    - '6379:6379'
  volumes:
    - dragonfly_data:/data
  ulimits:
    memlock: -1
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
    timeout: 5s
    retries: 5
```

Add `dragonfly_data` to the `volumes:` section.

### `.env.example`

Move into the **Required** section (alongside `DATABASE_URL`, `BASE_URL`, `SECRET_KEY`):

```bash
# Redis/Dragonfly connection for background job queue (BullMQ)
# Dragonfly is included in docker-compose and started by `bun run setup`.
REDIS_URL="redis://localhost:6379"
```

### `config.ts`

Change `redisUrl` to **required**: `redisUrl: z.string().min(1)` in schema, `process.env.REDIS_URL` in env mapping, `get redisUrl()` getter.

## Implementation

### Files Changed

| File                              | Change                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `events/process.ts`               | Replace `Promise.allSettled` with BullMQ Queue + Worker + SIGTERM handler                                             |
| `events/hook-utils.ts`            | Expand `isRetryableError()` for Bun error codes and `AbortError`                                                      |
| `events/handlers/webhook.ts`      | Stop calling `updateWebhookFailure` for retryable errors, add `isRetryableError` import, remove stale TODO (line 129) |
| `events/handlers/email.ts`        | `shouldRetry: isRetryableError(error)` instead of blanket `true`                                                      |
| `events/handlers/notification.ts` | `shouldRetry: isRetryableError(error)` instead of regex                                                               |
| `events/hook-types.ts`            | Remove `ProcessResult` (unused)                                                                                       |
| `events/index.ts`                 | Remove `ProcessResult` export, add `closeQueue` export                                                                |
| `events/dispatch.ts`              | Update JSDoc (hooks now run in background, not before response)                                                       |
| `config.ts`                       | Add `redisUrl` as **required** config property                                                                        |
| `package.json`                    | Add `bullmq` dependency                                                                                               |
| `.env.example`                    | Add `REDIS_URL` to Required section                                                                                   |
| `docker-compose.yml`              | Add Dragonfly service + volume                                                                                        |

**Not changed**: `targets.ts`, `registry.ts`, other hook handlers (Slack, Discord, Linear), `packages/db/`, `packages/ids/`. Note: `handlers/ai.ts` always returns `{ success: true }` even on failure — AI hooks will never retry. Pre-existing, out of scope.

---

### `events/process.ts`

```typescript
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

interface HookJobData {
  hookType: string
  event: EventData
  target: unknown
  config: Record<string, unknown>
}

const QUEUE_NAME = 'event-hooks'

// Webhook handlers do DNS + HTTP with a 5s timeout. 5 concurrent workers
// keeps outbound connections reasonable on modest hardware while still
// processing events promptly. Increase if throughput demands it.
const CONCURRENCY = 5

const CONNECTION_OPTS = { url: '', maxRetriesPerRequest: null as null }

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: true, // no dashboard yet — remove immediately
  removeOnFail: { age: 30 * 86400 }, // keep failed jobs 30 days
}

let initPromise: Promise<{ queue: Queue<HookJobData>; worker: Worker<HookJobData> }> | null = null

/**
 * Lazily initialize BullMQ queue and worker.
 * Uses a Promise to guard against concurrent first-call race conditions.
 */
function ensureQueue(): Promise<Queue<HookJobData>> {
  if (!initPromise) {
    initPromise = initializeQueue()
  }
  return initPromise.then(({ queue }) => queue)
}

async function initializeQueue() {
  const connOpts = { ...CONNECTION_OPTS, url: config.redisUrl }

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
      updateWebhookFailureCount(job.data).catch((err) =>
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
async function updateWebhookFailureCount(data: HookJobData): Promise<void> {
  const webhookId = (data.config as { webhookId?: string }).webhookId
  if (!webhookId) return

  const { db, webhooks, eq, sql } = await import('@/lib/server/db')
  const MAX_FAILURES = 50

  await db
    .update(webhooks)
    .set({
      failureCount: sql`${webhooks.failureCount} + 1`,
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

  for (const { type, target, config: hookConfig } of targets) {
    await queue.add(`${event.type}:${type}`, {
      hookType: type,
      event,
      target,
      config: hookConfig,
    })
  }
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
process.on('SIGTERM', () => {
  console.log('[Event] SIGTERM received, closing queue...')
  closeQueue().then(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[Event] SIGINT received, closing queue...')
  closeQueue().then(() => process.exit(0))
})
```

---

### `events/hook-utils.ts` — `isRetryableError()` (final version)

Checks both `status` and `code` sequentially (no early returns) so errors with both properties are fully evaluated. Uses a `Set` for retryable codes.

```typescript
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ConnectionRefused', // Bun's fetch error code
])

export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  // AbortError from fetch timeout
  if (error instanceof Error && error.name === 'AbortError') return true

  if ('status' in error) {
    const status = Number((error as { status: unknown }).status)
    if (status === 429 || (status >= 500 && status < 600)) return true
  }

  if ('code' in error) {
    const code = String((error as { code: unknown }).code)
    if (RETRYABLE_CODES.has(code)) return true
  }

  return false
}
```

---

### Handler Fixes

#### `email.ts` (line 50) — blanket `shouldRetry: true` retries invalid addresses

```diff
+ import { isRetryableError } from '../hook-utils'
  // In catch block:
- shouldRetry: true,
+ shouldRetry: isRetryableError(error),
```

#### `notification.ts` (line 72) — fragile regex breaks if error wording changes

```diff
+ import { isRetryableError } from '../hook-utils'
  // In catch block:
- shouldRetry: error instanceof Error && /database|connection/i.test(error.message),
+ shouldRetry: isRetryableError(error),
```

#### `webhook.ts` — simplify failure handling

With webhook failure counting moved to the BullMQ `worker.on('failed')` callback in `process.ts`, the webhook handler no longer needs to call `updateWebhookFailure` for retryable errors. It still calls it for non-retryable failures (SSRF, 4xx) so the error is recorded immediately.

```diff
+ import { isRetryableError } from '../hook-utils'

  // Line 129 — delete stale TODO:
- // TODO: Add background retry queue for failed deliveries

  // Non-2xx path (line 150-158):
+ const retryable = response.status >= 500 || response.status === 429
- await updateWebhookFailure(webhookId, error)
- return { success: false, error, shouldRetry: response.status >= 500 || response.status === 429 }
+ if (!retryable) await updateWebhookFailure(webhookId, error)
+ return { success: false, error, shouldRetry: retryable }

  // Catch block (line 159-168):
+ const retryable = isRetryableError(error)
- await updateWebhookFailure(webhookId, errorMsg)
- return { success: false, error: errorMsg, shouldRetry: true }
+ if (!retryable) await updateWebhookFailure(webhookId, errorMsg)
+ return { success: false, error: errorMsg, shouldRetry: retryable }
```

No signature change to `updateWebhookFailure` — it is simply not called for retryable errors. On permanent failure after retries exhaust, the `worker.on('failed')` callback in `process.ts` increments `failureCount` and checks auto-disable.

### `events/dispatch.ts` — JSDoc update

```diff
  /**
-  * Event dispatching - async event dispatch with inline building.
-  *
-  * Events are awaited to ensure hooks complete before the response is sent.
-  * Errors are caught and logged rather than propagated to the caller.
+  * Event dispatching - async event dispatch.
+  *
+  * processEvent() resolves targets and enqueues hooks (fast, ~10-50ms).
+  * Hook execution runs in the background via BullMQ.
+  * Errors are caught and logged rather than propagated to the caller.
   */
```

**Caller impact**: `dispatchPostCreated`, `dispatchPostStatusChanged`, and `dispatchCommentCreated` currently `await` dispatch. After this change, they still await — but only target resolution + enqueue, not hook completion. Callers no longer block on hook execution. Tests that assert hook side effects (e.g., "Slack was notified") immediately after dispatch will need to either: wait for the worker to process, or mock BullMQ to run jobs synchronously.

## Acceptance Criteria

### Core

- [ ] `processEvent` enqueues via BullMQ `Queue.add()` — no inline fallback
- [ ] Hook execution is non-blocking — HTTP response returns after target resolution + enqueue
- [ ] `shouldRetry: true` → throw `Error` → BullMQ retries (3 attempts, exponential backoff, 1s base)
- [ ] `shouldRetry: false/undefined` → throw `UnrecoverableError` → no retry
- [ ] Thrown exceptions: retryable per `isRetryableError()` → rethrow; else → `UnrecoverableError`
- [ ] Failed jobs retained 30 days; completed jobs removed immediately
- [ ] `closeQueue()` shuts down worker + queue with try/catch resilience
- [ ] `ProcessResult` removed from `hook-types.ts` and `index.ts`
- [ ] SIGTERM/SIGINT handlers call `closeQueue()` for graceful shutdown
- [ ] `ensureQueue()` uses Promise guard to prevent race condition on concurrent first call

### Handler fixes

- [ ] `isRetryableError()`: checks both `status` and `code` sequentially (no early returns); `AbortError`, `ConnectionRefused` (Bun), `ECONNREFUSED` added; no blanket `TypeError`
- [ ] Email: `shouldRetry: isRetryableError(error)` (not blanket `true`)
- [ ] Notification: `shouldRetry: isRetryableError(error)` (not regex)
- [ ] Webhook: skip `updateWebhookFailure` for retryable errors; `isRetryableError` in catch; stale TODO removed
- [ ] Webhook failure counting moved to `worker.on('failed')` — fires only on permanent failure

### Infrastructure

- [ ] Dragonfly `v1.27.1` in `docker-compose.yml` with healthcheck
- [ ] `REDIS_URL` in `.env.example` Required section
- [ ] `redisUrl` required in `config.ts`
- [ ] `bullmq` in `package.json`

### Tests

- [ ] Worker: success → return; `shouldRetry:true` → `Error`; `shouldRetry:false/undefined` → `UnrecoverableError`
- [ ] Worker: retryable throw → rethrown; `TypeError` → `UnrecoverableError`; unknown hook → `UnrecoverableError`
- [ ] Worker `failed` event: permanent failure → logs "permanently failed" + increments webhook count; intermediate → logs attempt number only
- [ ] `processEvent` → calls `queue.add()` per target (no `getHook` check at enqueue time)
- [ ] `isRetryableError`: `AbortError` → true; `ConnectionRefused` → true; `TypeError` → false; error with both `status: 200` and `code: 'ECONNRESET'` → true (checks both)
- [ ] Webhook: 5xx → no `updateWebhookFailure` call; 4xx → `updateWebhookFailure` called; SSRF → `updateWebhookFailure` called
- [ ] Email/Notification: network error → retry; validation error → no retry
- [ ] Mock BullMQ in unit tests (`vi.mock('bullmq')`); `afterEach` calls `closeQueue()`
- [ ] `closeQueue()` resilient: one close failing doesn't prevent others from running

## Notes

**Bun compatibility**: BullMQ depends on ioredis (Node.js `net`/`tls`). Bun 1.3.7+ supports these. Verify during implementation.

**Future work**: Bull Board dashboard (then change `removeOnComplete` to `{ age: 3600 }`), per-hook-type queues for rate limits, replay UI for failed jobs, email fan-out batching, remove Cloudflare Workers config (`wrangler.json`).
