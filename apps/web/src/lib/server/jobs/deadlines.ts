/**
 * When does this workspace next have work that a clock, rather than a person, will
 * create?
 *
 * ## The problem this replaces
 *
 * Two schedules in `definitions.ts` ran on `* * * * *` for every workspace, for
 * ever: `snooze-sweep` and `sla-breach-sweep`. That is 2,880 job executions per
 * workspace per day, and — on a platform that suspends a compute after about five
 * minutes with no client — it is fatal to the cost model on its own. A wake
 * every sixty seconds against a three-hundred-second suspend timer means the
 * compute never suspends, whatever the connection tiers do about their own
 * sockets. Measured on this platform the timer is 318–337s, so a per-minute tick
 * is not close to the boundary; it is five times inside it.
 *
 * The obvious fix — a longer interval — is the worst available move in a
 * specific way. An interval *near* the suspend timeout is worse than either
 * extreme: a five-minute sweep wakes every workspace precisely as it is about to
 * suspend, so the fleet pays for a compute that is permanently awake **and**
 * accepts five minutes of sweep latency for it. To buy anything at all, an
 * interval has to clear the timeout by a real margin, and every second of that
 * margin is latency an SLA breach or a snoozed conversation waits.
 *
 * ## The interval is the wrong question
 *
 * Neither sweep is periodic work. Both are **deadline** work: a conversation is
 * snoozed *until* a stated instant, an SLA clock is stamped with a due *at*. The
 * database already knows every one of those instants, and every one of them is
 * covered by a partial index that exists precisely because the sweeps scan on
 * it. So the workspace can be asked "when is your next deadline?" instead of being
 * woken to be asked "is anything due?".
 *
 * That removes the trade rather than repricing it:
 *
 * - a workspace with nothing pending contributes **no wakes at all** — the schedule
 *   is inert, the loops detach, and the compute suspends;
 * - a workspace with a deadline three days out is inert for three days and wakes
 *   once, at the deadline;
 * - a workspace with a deadline in the next minute ticks exactly as it does today,
 *   so **nothing is ever noticed later than it is now**.
 *
 * The last point is why this needed no product decision about acceptable
 * staleness: the cron expressions are unchanged, and the gate can only suppress
 * a tick that would have found nothing to do.
 *
 * ## Two consumers, one query
 *
 * The same provider answers both questions the job worker asks, which is the reason
 * they cannot disagree:
 *
 * 1. `dueWithin()` gates the cron — is the next deadline inside the next slot?
 * 2. `earliestWorkspaceDeadline()` tells a **detaching** tier when to come back, so
 *    a workspace that has gone quiet with a deadline pending still wakes for it
 *    rather than waiting out the rescan interval.
 *
 * A provider that threw, or one that has not been registered, is treated as
 * "due now". That is the fail-safe direction: the cost of a wrong `now` is a
 * tick that finds nothing, and the cost of a wrong `null` is work that never
 * runs.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'job-deadlines' })

/**
 * The earliest instant this workspace has due work of one kind, or null when it has
 * none at all. Runs inside a workspace scope.
 */
export type WorkspaceDeadlineProvider = () => Promise<Date | null>

const providers = new Map<string, WorkspaceDeadlineProvider>()

/**
 * Register a queue's deadline source.
 *
 * Called at module load of the queue's own module, which `primeJobHandlers()`
 * imports before any workspace scope is open — so registration is process-wide and
 * scope-free, while every call to the provider happens inside a scope.
 */
export function registerWorkspaceDeadline(
  queue: string,
  provider: WorkspaceDeadlineProvider
): void {
  providers.set(queue, provider)
}

/** Test seam: forget every provider. */
export function __resetWorkspaceDeadlinesForTests(): void {
  providers.clear()
}

/**
 * One queue's next deadline, fail-safe.
 *
 * `undefined` for a queue nobody registered, which the caller must read as "no
 * opinion" rather than "nothing due" — a queue with no provider keeps its cron
 * exactly as written.
 */
export async function queueDeadline(queue: string): Promise<Date | null | undefined> {
  const provider = providers.get(queue)
  if (!provider) return undefined
  try {
    return await provider()
  } catch (err) {
    // Fail towards running: a provider that cannot answer must not be able to
    // silence a sweep.
    log.error({ err, queue }, 'deadline provider threw; treating the queue as due now')
    return new Date(0)
  }
}

/**
 * Should this queue's cron tick at all right now?
 *
 * True when there is no provider (the cron stands as written), or when the next
 * deadline falls inside `windowMs` of `now`. The window is the schedule's own
 * slot length, so the gate can only ever suppress a tick that had nothing to do.
 */
export async function dueWithin(
  queue: string,
  windowMs: number,
  now = Date.now()
): Promise<boolean> {
  const deadline = await queueDeadline(queue)
  if (deadline === undefined) return true
  if (deadline === null) return false
  return deadline.getTime() <= now + windowMs
}

/**
 * The earliest deadline across every registered queue for this workspace, rounded
 * up to the next whole minute.
 *
 * What a detaching loop records so it knows when to come back. Null means no
 * clock-driven work exists at all, which is the only state in which sleeping
 * until the safety-net rescan is the whole answer.
 *
 * ## The rounding is load-bearing, and it was found by measurement
 *
 * These deadlines are not acted on directly. They are acted on by a **cron
 * slot**, and `cron.ts` is a minute-resolution evaluator — `latestSlotAtOrBefore`
 * returns the slot bracketing now, and a slot already spent is not spent again.
 * So a tier woken at 14:05:23 for a deadline of 14:05:23 finds the 14:05 slot
 * already taken, enqueues nothing, goes idle, recomputes the same deadline —
 * now in the *past* — and wakes again immediately.
 *
 * Measured, that is a reconnect every detach interval forever: strictly worse
 * than the per-minute cron this replaced, and invisible in every arm that only
 * counted enqueues. Rounding up to the next minute makes the wake land on a slot
 * the schedule can actually spend, and `max(now, deadline)` makes a deadline
 * that has already passed still resolve to a future instant rather than to zero.
 */
export async function earliestWorkspaceDeadline(now = Date.now()): Promise<Date | null> {
  let earliest: Date | null = null
  for (const queue of providers.keys()) {
    const at = await queueDeadline(queue)
    if (at === undefined || at === null) continue
    if (earliest === null || at < earliest) earliest = at
  }
  if (earliest === null) return null
  return nextMinuteBoundaryAfter(Math.max(now, earliest.getTime()))
}

/** The next whole minute strictly after `ms`. Never returns the current one. */
function nextMinuteBoundaryAfter(ms: number): Date {
  return new Date(Math.floor(ms / 60_000) * 60_000 + 60_000)
}
