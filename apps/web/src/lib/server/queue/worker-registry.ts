/**
 * Declarative registry of every BullMQ queue/worker module in the process.
 *
 * Boot and graceful shutdown iterate this one list, so a worker can't be
 * started without also being drained. Entries use dynamic imports so the
 * underlying modules stay lazy until boot or drain touches them. The seal
 * test in __tests__ pins the list against the modules that actually
 * construct a BullMQ Worker.
 *
 * **This list is shrinking.** The seven periodic sweeps that used to live here
 * — `anon-sweep`, `page-view-partitions`, `sla-breach-sweep`, `snooze-sweep`,
 * `workflow-sweep`, `workflow-retention`, `analytics` — now run on the Postgres
 * job queue (`lib/server/jobs`), which is per-tenant by construction and needs
 * no Redis. They are registered in `jobs/definitions.ts` and started by
 * `jobs/tier.ts`; the same seal discipline applies there. The eight below are
 * the remaining BullMQ workers, and Redis cannot be removed until they move too
 * (SAAS-HOSTING-STACK.md §7.1, §7.4).
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'worker-registry' })

export interface WorkerEntry {
  /** Stable short name, used in logs and the readiness payload. */
  name: string
  /**
   * Eager boot hook. Absent for modules that initialize lazily on first
   * enqueue; their close is still registered so shutdown drains them.
   */
  init?: () => Promise<void>
  /** Drain the queue + worker. Safe to call when never initialized. */
  close: () => Promise<void>
}

export const WORKER_REGISTRY: readonly WorkerEntry[] = [
  {
    // Event fan-out (webhooks, integrations). Initializes on first publish.
    name: 'events',
    close: () => import('@/lib/server/events/process').then((m) => m.closeQueue()),
  },
  {
    // Restoring persisted schedules also creates the queue + worker.
    name: 'segment-scheduler',
    init: () =>
      import('@/lib/server/events/segment-scheduler').then((m) =>
        m.restoreAllEvaluationSchedules()
      ),
    close: () =>
      import('@/lib/server/events/segment-scheduler').then((m) => m.closeSegmentScheduler()),
  },
  {
    // Help-center auto-translate (domains/languages §H3). Initializes on
    // first enqueue (article publish with autoTranslate.enabled).
    name: 'help-center-translate',
    close: () =>
      import('@/lib/server/domains/help-center/help-center-translate-queue').then((m) =>
        m.closeHelpCenterTranslateQueue()
      ),
  },
  {
    // Inbound email poller (IMAP, Layer 1). Init no-ops unless configured.
    name: 'email-imap',
    init: () =>
      import('@/lib/server/domains/conversation/conversation.email-imap-queue').then((m) =>
        m.initEmailImapWorker()
      ),
    close: () =>
      import('@/lib/server/domains/conversation/conversation.email-imap-queue').then((m) =>
        m.closeEmailImapQueue()
      ),
  },
  {
    // Durable workflow-trigger dispatch (§4.6). Runs dispatchWorkflowsForEvent
    // off a BullMQ job instead of fire-and-forget, so a crash/deploy between
    // the event landing and the dispatch running retries instead of silently
    // losing the trigger. Eagerly initialized (like workflow-wait/
    // workflow-sweep below) so the cold-start Redis handshake happens at
    // boot instead of on the first workflow-triggering event.
    name: 'workflow-dispatch',
    init: () =>
      import('@/lib/server/domains/workflows/workflow-dispatch-queue').then((m) =>
        m.initWorkflowDispatchWorker()
      ),
    close: () =>
      import('@/lib/server/domains/workflows/workflow-dispatch-queue').then((m) =>
        m.closeWorkflowDispatchQueue()
      ),
  },
  {
    // Durable workflow waits (§4.6). Resumes parked runs when their timer fires.
    name: 'workflow-wait',
    init: () =>
      import('@/lib/server/domains/workflows/workflow-wait-queue').then((m) =>
        m.initWorkflowWaitWorker()
      ),
    close: () =>
      import('@/lib/server/domains/workflows/workflow-wait-queue').then((m) =>
        m.closeWorkflowWaitQueue()
      ),
  },
  {
    // Async import commit (Imports & exports hub §I1). Initializes on first enqueue.
    name: 'import',
    close: () =>
      import('@/lib/server/domains/import/import-queue').then((m) => m.closeImportQueue()),
  },
  {
    // Async workspace data export. Initializes on first enqueue.
    name: 'export',
    close: () =>
      import('@/lib/server/domains/export/export-queue').then((m) => m.closeExportQueue()),
  },
]

type WorkerBootState = 'pending' | 'running' | 'failed'

const bootState = new Map<string, WorkerBootState>()

/**
 * Eagerly initialize every worker that declares an init hook. Fire-and-forget
 * per entry: a failed init is logged and must not block the others.
 */
export function initAllWorkers(entries: readonly WorkerEntry[] = WORKER_REGISTRY): void {
  for (const entry of entries) {
    if (!entry.init) continue
    bootState.set(entry.name, 'pending')
    entry
      .init()
      .then(() => bootState.set(entry.name, 'running'))
      .catch((err) => {
        bootState.set(entry.name, 'failed')
        log.error({ err, worker: entry.name }, 'worker init failed')
      })
  }
}

/**
 * Drain every registered worker. Failures are logged, never thrown, so one
 * rejected close can't stop the rest from draining.
 */
export async function closeAllWorkers(
  entries: readonly WorkerEntry[] = WORKER_REGISTRY
): Promise<void> {
  const results = await Promise.allSettled(entries.map((e) => e.close()))
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      log.error({ err: r.reason, worker: entries[i]?.name }, 'worker close failed')
    }
  })
}

/**
 * Boot-state counts across eagerly-initialized workers, for the readiness
 * probe. Lazy (close-only) entries carry no boot state.
 */
export function getWorkerBootStatus(): {
  total: number
  running: number
  pending: number
  failed: number
} {
  let running = 0
  let pending = 0
  let failed = 0
  for (const state of bootState.values()) {
    if (state === 'running') running++
    else if (state === 'pending') pending++
    else failed++
  }
  return { total: bootState.size, running, pending, failed }
}
