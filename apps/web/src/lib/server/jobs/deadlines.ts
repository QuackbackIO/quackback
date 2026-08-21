/**
 * When does this tenant next have work that a clock, rather than a person, will
 * create?
 *
 * Two schedules in `definitions.ts` run on `* * * * *` for every tenant:
 * `snooze-sweep` and `sla-breach-sweep`. Ungated, that is 2,880 job executions
 * per tenant per day, almost all of which find nothing to do. Neither sweep is
 * periodic work — both are **deadline** work: a conversation is snoozed *until*
 * a stated instant, an SLA clock is stamped with a due *at*. The database
 * already knows every one of those instants, and every one of them is covered
 * by a partial index that exists precisely because the sweeps scan on it. So
 * the tenant is asked "when is your next deadline?" instead of being woken to
 * be asked "is anything due?".
 *
 * - a tenant with nothing pending enqueues no sweep jobs at all;
 * - a tenant with a deadline three days out enqueues nothing for three days;
 * - a tenant with a deadline in the next minute ticks exactly as it does
 *   ungated, so **nothing is ever noticed later than it is now**.
 *
 * The last point is why this needed no product decision about acceptable
 * staleness: the cron expressions are unchanged, and the gate can only suppress
 * a tick that would have found nothing to do.
 *
 * A provider that threw, or one that has not been registered, is treated as
 * "due now". That is the fail-safe direction: the cost of a wrong `now` is a
 * tick that finds nothing, and the cost of a wrong `null` is work that never
 * runs.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'job-deadlines' })

/**
 * The earliest instant this tenant has due work of one kind, or null when it has
 * none at all. Runs inside a tenant scope.
 */
export type TenantDeadlineProvider = () => Promise<Date | null>

const providers = new Map<string, TenantDeadlineProvider>()

/**
 * Register a queue's deadline source.
 *
 * Called at module load of the queue's own module, which `primeJobHandlers()`
 * imports before any tenant scope is open — so registration is process-wide and
 * scope-free, while every call to the provider happens inside a scope.
 */
export function registerTenantDeadline(queue: string, provider: TenantDeadlineProvider): void {
  providers.set(queue, provider)
}

/** Test seam: forget every provider. */
export function __resetTenantDeadlinesForTests(): void {
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
