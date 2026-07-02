/**
 * Declarative registry of every BullMQ queue/worker module in the process.
 *
 * Boot and graceful shutdown iterate this one list, so a worker can't be
 * started without also being drained. Entries use dynamic imports so the
 * underlying modules stay lazy until boot or drain touches them. The seal
 * test in __tests__ pins the list against the modules that actually
 * construct a BullMQ Worker.
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
    name: 'feedback-ai',
    init: () =>
      import('@/lib/server/domains/feedback/queues/feedback-ai-queue').then((m) =>
        m.initFeedbackAiWorker()
      ),
    close: () =>
      import('@/lib/server/domains/feedback/queues/feedback-ai-queue').then((m) =>
        m.closeFeedbackAiQueue()
      ),
  },
  {
    // Feedback ingestion. Initializes on first enqueue.
    name: 'feedback-ingest',
    close: () =>
      import('@/lib/server/domains/feedback/queues/feedback-ingest-queue').then((m) =>
        m.closeFeedbackIngestQueue()
      ),
  },
  {
    name: 'analytics',
    init: () =>
      import('@/lib/server/domains/analytics/analytics-queue').then((m) => m.initAnalyticsWorker()),
    close: () =>
      import('@/lib/server/domains/analytics/analytics-queue').then((m) => m.closeAnalyticsQueue()),
  },
  {
    name: 'anon-sweep',
    init: () =>
      import('@/lib/server/domains/principals/anon-sweep-queue').then((m) =>
        m.initAnonSweepWorker()
      ),
    close: () =>
      import('@/lib/server/domains/principals/anon-sweep-queue').then((m) =>
        m.closeAnonSweepQueue()
      ),
  },
  {
    name: 'page-view-partitions',
    init: () =>
      import('@/lib/server/domains/analytics/partition-maintenance-queue').then((m) =>
        m.initPageViewPartitionWorker()
      ),
    close: () =>
      import('@/lib/server/domains/analytics/partition-maintenance-queue').then((m) =>
        m.closePageViewPartitionQueue()
      ),
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
