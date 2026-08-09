/**
 * Constructing a BullMQ `Worker` without inheriting whoever armed it.
 *
 * ## The defect this exists to remove
 *
 * A `Worker`'s `run()` loop starts synchronously inside its constructor, so the
 * AsyncLocalStorage context alive at construction becomes the context for
 * **every job it ever processes**. Measured against real BullMQ and real Redis:
 *
 * ```
 * Worker constructed inside als.run({tenant:'TENANT-A'}, …)
 * jobs added from TENANT-B and TENANT-C scopes
 * [ {"job":"B-job","scopeSeenByProcessor":"TENANT-A"},
 *   {"job":"C-job","scopeSeenByProcessor":"TENANT-A"} ]
 * ```
 *
 * That store is where `getCurrentTenant()` lives. So a processor that touches
 * `db` reads the *arming* tenant's database, for every tenant's jobs, forever —
 * SAAS-HOSTING-STACK.md §3's exact failure mode: no error, no failed permission
 * check, self-consistent rows from the wrong workspace.
 *
 * And the arming is request-reachable. Seven queue modules arm lazily on first
 * enqueue (`ensureQueue()`), four of them have no eager `init` hook in
 * `worker-registry.ts` at all, and `middleware/request-scope.ts` runs every
 * request inside `runWithTenantScope`. So under pooled tenancy the first
 * request to trigger an export, import, event fan-out or help-centre
 * translation arms the worker with that tenant's scope welded on.
 *
 * ## Why detaching is the right shape, and what it deliberately does NOT do
 *
 * A processor is not request work; it must carry no ambient tenant. Detaching
 * at construction makes the inheritance impossible rather than unlikely.
 *
 * What it does not do is *give* the processor the right tenant. Routing a job
 * to its own tenant scope needs the job to carry a tenant and the queue to be
 * per-tenant, which is the Postgres-queue work in §7 — not this piece. Until
 * that lands, a processor running under pooled tenancy reaches `db` with no
 * scope and `TenantScopeMissingError` throws. That is the intended outcome: the
 * job fails loudly and retries, instead of succeeding against a stranger's
 * database.
 *
 * ## Why this refuses under pooled tenancy, and why the ROLE is not the gate
 *
 * An earlier version of this fix put the refusal in `config.ts`: pooled tenancy
 * would only boot with `QUACKBACK_ROLE=web`. That was wrong, and wrong in a way
 * worth recording, because it banned the wrong noun.
 *
 * The property that matters is "a pooled process must not consume BULLMQ
 * queues". The role and BullMQ stopped being the same thing the moment a
 * second, pooled-safe job tier existed — that tier opens a real tenant scope per
 * claim and runs per-tenant loops, and it is gated ON `shouldRunWorkers()`. So
 * banning every role but `web` banned exactly the role the pooled worker tier
 * needs, and the two guards compose into a fleet with no runnable
 * configuration: SAAS-HOSTING-STACK.md §1 says the conductor *is*
 * `QUACKBACK_ROLE=worker`, and the config gate made that unrepresentable.
 *
 * The refusal therefore lives here, on the noun it is actually about. Under
 * pooled tenancy no BullMQ `Worker` is constructed at all, whatever the role;
 * the queue still accepts work, exactly as a `role=web` replica does today, and
 * a pooled-safe tier is free to run alongside.
 */
import { Worker, type Job, type Processor, type WorkerOptions } from 'bullmq'
import { runWithoutLogContext } from '@/lib/server/log-context'
import { isPooledTenancy } from '@/lib/server/tenancy/mode'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'queue-worker' })

/** Queues already warned about, so one line per queue rather than per call. */
const refused = new Set<string>()

/**
 * `new Worker(...)`, detached from any ambient async context — or `null` under
 * pooled tenancy, where a BullMQ consumer must not exist at all.
 *
 * Drop-in for the constructor apart from the nullable return, which every call
 * site already handles: the role gate has always produced `Worker | null`.
 * `queue/__tests__/worker-registry.test.ts` fails CI if a queue module calls
 * `new Worker` directly instead.
 */
export function createQueueWorker<
  TData = unknown,
  TResult = unknown,
  TName extends string = string,
>(
  name: string,
  processor: Processor<TData, TResult, TName> | string | URL,
  opts: WorkerOptions
): Worker<TData, TResult, TName> | null {
  if (isPooledTenancy()) {
    // Loud, but once per queue: this is a boot-time fact about the deployment,
    // not a per-call error, and a line per enqueue would bury it.
    if (!refused.has(name)) {
      refused.add(name)
      log.error(
        { queue: name },
        'pooled tenancy — refusing to construct a BullMQ worker. Its run loop starts inside the ' +
          'constructor, so it would keep the tenant scope of whichever request armed it for every ' +
          'job it ever handled. Producers still enqueue; jobs accumulate until a pooled-safe job ' +
          'tier drains them.'
      )
    }
    return null
  }
  return runWithoutLogContext(() => new Worker<TData, TResult, TName>(name, processor, opts))
}

/** Test seam: forget which queues have already logged the refusal. */
export function __resetQueueWorkerRefusals(): void {
  refused.clear()
}

/** Re-exported so call sites need one import, not two. */
export type { Job }
