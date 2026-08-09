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
 * Config refuses to boot in that configuration anyway (`config.ts`'s pooled
 * refinement rejects a worker-running role), so this is the second layer. Both
 * exist because the first is an operator setting and the second is a property
 * of the code.
 */
import { Worker, type Job, type Processor, type WorkerOptions } from 'bullmq'
import { runWithoutLogContext } from '@/lib/server/log-context'

/**
 * `new Worker(...)`, detached from any ambient async context.
 *
 * Drop-in for the constructor: same arguments, same return type. Every queue
 * module uses this instead of `new Worker` directly, and
 * `policy/module-state/__tests__` fails CI if a new one does not.
 */
export function createQueueWorker<
  TData = unknown,
  TResult = unknown,
  TName extends string = string,
>(
  name: string,
  processor: Processor<TData, TResult, TName> | string | URL,
  opts: WorkerOptions
): Worker<TData, TResult, TName> {
  return runWithoutLogContext(() => new Worker<TData, TResult, TName>(name, processor, opts))
}

/** Re-exported so call sites need one import, not two. */
export type { Job }
