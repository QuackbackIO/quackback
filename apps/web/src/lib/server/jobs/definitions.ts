/**
 * The job definition registry — one place that knows every queue, its handler,
 * and its retry policy.
 *
 * Same principle as `queue/worker-registry.ts`: one list drives boot, drain and
 * the readiness payload, so a queue cannot exist that the tier does not know how
 * to run or stop. Definitions are declared as data rather than discovered, and
 * `noRetry` is expressed here rather than at each enqueue site so the property
 * that matters most — `import` and `export` run at most once — is visible in one
 * screen instead of inferred from call sites.
 *
 * Handlers are dynamic imports for the same reason the BullMQ registry used
 * them: the underlying domain modules stay lazy until the tier actually runs.
 */
import type { ClaimedJob } from './job-queue'

export type JobHandler = (job: ClaimedJob) => Promise<void>

export interface JobDefinition {
  /** Queue name. Also the `queue` column value and the NOTIFY payload. */
  name: string
  /** Loaded on first execution, not at import time. */
  handler: () => Promise<JobHandler>
  /**
   * Total attempts. **1 means at-most-once**: a lease that expires because the
   * process died goes terminal rather than back to pending.
   */
  maxAttempts?: number
  /**
   * Initial lease. The handler heartbeats while it works, so this is "how long
   * after a process death before the job is reclaimable", not "how long the job
   * may take".
   */
  leaseMs?: number
  /** Delay before the first retry; doubled per attempt. Ignored when maxAttempts is 1. */
  retryBackoffMs?: number
  /** Cron schedule that enqueues this job. Absent for jobs enqueued on demand. */
  cron?: string
}

/** Defaults chosen to match what the BullMQ workers used. */
export const DEFAULT_LEASE_MS = 60_000
export const DEFAULT_RETRY_BACKOFF_MS = 5_000

/**
 * The seven already-solved-shape sweeps (SAAS-HOSTING-STACK.md §7.1).
 *
 * Every one was a BullMQ repeatable job with `concurrency: 1`, `attempts: 3`,
 * exponential backoff from 5s, and a payload carrying nothing but a discriminant.
 * The cron patterns, retry counts and backoff below are the same values, so the
 * observable cadence and failure behaviour do not move.
 */
export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  {
    name: 'anon-sweep',
    cron: '0 3 * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/principals/anon-sweep-queue').then((m) => m.runAnonSweep),
  },
  {
    name: 'page-view-partitions',
    cron: '30 2 * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/analytics/partition-maintenance-queue').then(
        (m) => m.runPageViewPartitionMaintenance
      ),
  },
  {
    name: 'sla-breach-sweep',
    cron: '* * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/sla/sla-breach-sweep-queue').then((m) => m.runSlaBreachSweep),
  },
  {
    name: 'snooze-sweep',
    cron: '* * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/conversation/snooze-sweep-queue').then((m) => m.runSnoozeSweep),
  },
  {
    name: 'workflow-sweep',
    cron: '*/5 * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/workflows/workflow-sweep-queue').then((m) => m.runWorkflowSweep),
  },
  {
    name: 'workflow-retention',
    cron: '0 4 * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/workflows/workflow-retention-queue').then(
        (m) => m.runWorkflowRetention
      ),
  },
  {
    name: 'analytics',
    cron: '0 * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/analytics/analytics-queue').then((m) => m.runAnalyticsRefresh),
  },
]

let overrides: readonly JobDefinition[] | null = null

/** The definitions the tier will run. */
export function jobDefinitions(): readonly JobDefinition[] {
  return overrides ?? JOB_DEFINITIONS
}

/**
 * Test seam: replace the definition list for one test.
 *
 * Deliberately a whole-list swap rather than a merge — a test that adds a
 * definition to the real list would run the real sweeps against whatever
 * database it happened to be pointed at.
 */
export function __setJobDefinitionsForTests(defs: readonly JobDefinition[] | null): void {
  overrides = defs
}

export function findJobDefinition(name: string): JobDefinition | undefined {
  return jobDefinitions().find((d) => d.name === name)
}

export function leaseMsFor(def: JobDefinition): number {
  return def.leaseMs ?? DEFAULT_LEASE_MS
}

export function maxAttemptsFor(def: JobDefinition): number {
  return def.maxAttempts ?? 1
}

/**
 * Backoff for the next attempt, doubling per attempt made.
 *
 * Matches the BullMQ workers' `{ type: 'exponential', delay: 5000 }`, which
 * produced 5s, 10s, 20s.
 */
export function retryBackoffMs(def: JobDefinition, attemptsMade: number): number {
  const base = def.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS
  return base * Math.pow(2, Math.max(0, attemptsMade - 1))
}
