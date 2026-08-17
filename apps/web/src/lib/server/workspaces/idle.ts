/**
 * When an always-warm tier is allowed to stop being warm, and what brings it
 * back.
 *
 * ## The measurement this exists for
 *
 * Neon bills a compute for as long as **any** client is connected, and suspends
 * it once none is. `pool-cache.ts` already states that for the request path and
 * names the hazard it could not fix from there:
 *
 * > eviction is **necessary but not sufficient** … the outbox relay polls the
 * > workspace database once per second forever, so the compute never suspends
 * > whatever this cache does.
 *
 * Measured on a four-workspace fleet, that is exactly what happened: two `LISTEN`
 * connections per workspace held for 14h33m, four `postgres.js` connections
 * alongside them, and every workspace database at 45–70% active while doing no work
 * at all. A database nothing connects to sat at 2%. The platform suspends
 * correctly; the tiers were the reason it could not.
 *
 * ## The policy
 *
 * A tier holds its connections while a workspace is *doing something*, and lets go
 * of **all** of them after `detachAfterMs` of silence — the doorbell, the direct
 * pool, the lease, and the pooled entry in the request cache. Releasing only the
 * listener leaves the tier's own pool holding the compute awake, which is no
 * saving at all.
 *
 * That is safe because the doorbell is not load-bearing. `wake.ts` and
 * `relay-tier.ts` both say so: the poll is the correctness floor and a lost
 * doorbell costs latency, never correctness. Detaching is the same trade taken
 * deliberately — a detached workspace is one whose doorbell is *known* to be
 * absent, and whose poll has been slowed to a cadence that lets the compute
 * suspend between polls.
 *
 * ## Three things bring a detached tier back
 *
 * 1. **A signal.** Something in this process opened a workspace scope for a reason
 *    that is not one of the tiers — a request, a script, the migrator. That is
 *    deliberately broader than "work was enqueued", and the breadth is free:
 *    opening that scope already connected to the workspace database and therefore
 *    already woke the compute, so re-attaching to it costs one socket and no
 *    compute-seconds. Immediate.
 * 2. **A deadline.** The queue's own future work is exact rather than swept for.
 *    A detaching job tier reads the earliest pending `run_at` on the connection
 *    it is about to drop, and wakes at that moment. A delayed job and a retry
 *    therefore fire on time even though nothing was listening.
 * 3. **The rescan.** The safety net, `rescanIntervalMs`, for work that arrived
 *    without either of the above.
 *
 * ## The signal is in-process only, and that is a real limit
 *
 * Under `QUACKBACK_ROLE=all` — one process serving requests and running the
 * tiers — signal (1) covers every enqueue, because every enqueue happens inside
 * a workspace scope this process opened. Under a split `role=web` + `role=worker`
 * deployment it does not: the web replica opens the scope and the worker replica
 * is the one that has detached.
 *
 * A cross-process signal was designed and then withdrawn, and the reason belongs
 * here rather than in a commit message. The natural home for it is the control
 * database — one `LISTEN` there, rung by whichever replica opened the scope,
 * costs nothing per workspace and reaches every replica. But a permanent `LISTEN`
 * is a permanently-connected client, and the control database is now required to
 * suspend when the fleet goes quiet for exactly the same reason the workspaces are.
 * The two cannot both be had. So there is no cross-process signal, and under a
 * split deployment externally-enqueued work waits for the rescan.
 *
 * ## Why these numbers
 *
 * **`detachAfterMs` (60s).** Time to suspend is `detachAfterMs` plus the
 * platform's own timer (Neon's `suspend_timeout_seconds`, 300s by default), so
 * the only thing this number buys is not thrashing: a workspace that goes quiet for
 * forty seconds between two clicks should not pay a reconnect and a fingerprint
 * round trip. Sixty seconds is a fifth of the platform timer, and sixty times
 * the 1s poll interval, so a workspace doing anything at all at even 1/60 of the
 * poll cadence never detaches. It deliberately sits *above*
 * `workspacePoolIdleSeconds` (45s): the request cache should let go first, so that
 * by the time a tier detaches there is nothing of that workspace's left here.
 *
 * **`rescanIntervalMs` (15 min).** This is the number that trades money against
 * latency, and the arithmetic is worth stating because an operator will want to
 * move it. Each rescan connects, so the platform restarts its suspend timer
 * afterwards: a *fully* idle workspace is awake for roughly
 * `suspendTimeout / rescanIntervalMs` of the time — about 33% at Neon's default
 * 300s and fifteen minutes, against 100% today. The suspend timeout is the
 * fleet's own setting, so the same policy costs about 7% on a project configured
 * to suspend after 60s; lowering it is strictly better than lengthening this.
 *
 * Fifteen minutes is what the *other* side of the trade will bear. Two things
 * are bounded by it: a job enqueued by another replica under a split deployment,
 * and the per-minute cron sweeps (`snooze-sweep`, `sla-breach-sweep`), which do
 * not tick while detached. Those sweeps are catch-up sweeps — one run after a
 * gap does everything the skipped runs would have — so the cost is staleness,
 * not lost work, and fifteen minutes of staleness on a workspace with literally no
 * traffic is a fair price for a compute that is off.
 *
 * The wait is not `detachedAt + rescanIntervalMs`. That precessed: each
 * reconnect added the linger, so the fleet never shared a wake window with
 * itself or with the control database. `nextRescanAt` snaps to the next
 * epoch-aligned multiple of `rescanIntervalMs` plus a stable per-workspace
 * offset of at most 30s, and a rescan that finds nothing detaches again
 * immediately. Signal, deadline, and boot attaches still linger for
 * `detachAfterMs` — those have a user or due work on the other side, and
 * thrash protection matters there.
 *
 * Set `TENANT_IDLE_DETACH_MS=0` to disable detaching entirely and get the old
 * always-warm behaviour back, which is the correct setting for a single-workspace
 * install on a database that is never billed for idleness.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workspace-idle' })

export interface WorkspaceIdlePolicy {
  /** Silence before a tier releases every connection it holds for a workspace. */
  detachAfterMs: number
  /** Longest a detached tier will wait before looking for work it was not told about. */
  rescanIntervalMs: number
}

/**
 * Read from `process.env` directly rather than through the zod config, matching
 * `relayTierConfig()` and `runnerConfig()`: these must work in any context,
 * including a worker process that has not loaded the full application config.
 */
function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min) return fallback
  return n
}

export function workspaceIdlePolicy(): WorkspaceIdlePolicy {
  return {
    // Floor of 0 rather than 1: zero is the documented "never detach" setting.
    detachAfterMs: envInt('TENANT_IDLE_DETACH_MS', 60_000, 0),
    // Floor of one second. A rescan interval below the poll interval would be a
    // detached tier polling harder than an attached one.
    rescanIntervalMs: envInt('TENANT_IDLE_RESCAN_MS', 900_000, 1_000),
  }
}

/** True when this process should keep the old always-warm behaviour. */
export function idleDetachDisabled(policy: WorkspaceIdlePolicy): boolean {
  return policy.detachAfterMs <= 0
}

/**
 * Inclusive ceiling on the per-workspace rescan offset, in milliseconds.
 *
 * Thirty seconds is long enough to stop every workspace reconnecting in the
 * same instant, and short enough that the fleet still shares one wake window
 * against the platform's suspend timer.
 */
export const RESCAN_JITTER_MAX_MS = 30_000

/**
 * Stable key used to snap the control-database fleet re-read to the same
 * wall-clock grid the workspaces wake on. Not a real workspace.
 */
export const CONTROL_FLEET_RESCAN_KEY = '__control_fleet__'

/**
 * Per-workspace offset on the rescan grid, in `[0, 30_000]` ms.
 *
 * djb2 over `workspaceKey`, then modulo 30001. The same key always lands on
 * the same offset, so a workspace's place on the grid never drifts across
 * detaches or process restarts.
 */
export function rescanJitterMs(workspaceKey: string): number {
  let hash = 5381
  for (let i = 0; i < workspaceKey.length; i++) {
    hash = Math.imul(hash, 33) + workspaceKey.charCodeAt(i)
  }
  return (hash >>> 0) % (RESCAN_JITTER_MAX_MS + 1)
}

/**
 * Next instant a detached tier (or the fleet re-read) should look again.
 *
 * Wake instants are `k * policy.rescanIntervalMs + jitter` for integer `k` —
 * epoch-aligned, then shifted by {@link rescanJitterMs}. The returned value
 * is the smallest such instant strictly after `now`.
 *
 * When detach is disabled this is a passthrough (`now + rescanIntervalMs`)
 * that does not invent a grid wake. Callers already skip the detached wait
 * in that case; the passthrough is so a stray call cannot schedule one.
 */
export function nextRescanAt(
  now: number,
  policy: WorkspaceIdlePolicy,
  workspaceKey: string
): number {
  if (idleDetachDisabled(policy)) return now + policy.rescanIntervalMs
  const interval = policy.rescanIntervalMs
  const jitter = rescanJitterMs(workspaceKey)
  const slot = Math.floor((now - jitter) / interval) + 1
  return slot * interval + jitter
}

/**
 * Why a detached tier woke up. Carried into logs because the three mean very
 * different things: `signal` is the design working, `deadline` is the queue's
 * own future work, and `rescan` is the safety net catching something neither saw
 * — a steady stream of `rescan` wakes that find work means work is arriving by a
 * route nothing signals, which is worth knowing.
 */
export type ReattachReason = 'signal' | 'deadline' | 'rescan' | 'boot'

/** Who told us a workspace is busy. */
export type WorkspaceActivitySource = 'request' | 'sweep' | 'script' | 'migration'

type Subscriber = (workspaceKey: string, source: WorkspaceActivitySource) => void

const subscribers = new Set<Subscriber>()

/**
 * Say that something outside the always-warm tiers is using this workspace.
 *
 * Never called by the tiers for their own traffic. A tier that counted its own
 * polling as activity would never go idle, which is the bug this module exists
 * to remove — so the call site is `acquireWorkspaceScope`, filtered by scope
 * origin, and `queue` and `relay` are excluded there.
 */
export function noteWorkspaceActivity(workspaceKey: string, source: WorkspaceActivitySource): void {
  if (subscribers.size === 0) return
  for (const fn of subscribers) {
    try {
      fn(workspaceKey, source)
    } catch (err) {
      // A subscriber that throws must not break the request path it is being
      // called from. This signal is an optimisation over the rescan floor, and
      // an optimisation may not take the thing it optimises down with it.
      log.warn({ err, workspaceKey, source }, 'workspace activity subscriber threw')
    }
  }
}

/** Subscribe to the signal. Returns an unsubscribe function. */
export function onWorkspaceActivity(fn: Subscriber): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Test seam: forget every subscriber. */
export function __resetWorkspaceActivityForTests(): void {
  subscribers.clear()
}
