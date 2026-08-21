/**
 * The job definition registry — one place that knows every queue, its handler,
 * and its retry policy.
 *
 * One list drives boot, drain and the readiness payload, so a queue cannot exist
 * that the job worker does not know how to run or stop. Definitions are declared as
 * data rather than discovered, and `noRetry` is expressed here rather than at
 * each enqueue site so the property that matters most — `import` and `export`
 * run at most once — is visible in one screen instead of inferred from call
 * sites.
 *
 * Handlers are dynamic imports so the underlying domain modules stay lazy until
 * the job worker actually runs.
 */
import { HOOK_RETRY_ATTEMPTS, hookRetryDelayMs } from '@/lib/server/events/retry-schedule'
import type { ClaimedJob } from './job-queue'

export type JobHandler = (job: ClaimedJob) => Promise<void>

/**
 * A schedule this queue derives from the workspace's own database at tick time.
 *
 * `segment-evaluation` is the case that needs it: a workspace's dynamic
 * segments each carry their own cron pattern in a `segments` row, so the set of
 * schedules is per workspace and changes while the process runs. Under BullMQ that
 * was a repeatable job registered into Redis, which then had to be *restored*
 * at boot because Redis could have been cleared. Deriving it per tick removes
 * the restore step and the class of bug it existed for: there is no scheduler
 * state to lose, so it cannot drift from the rows that define it.
 */
export interface DynamicSchedule {
  /** Distinguishes this schedule from the others on the same queue. */
  key: string
  /** Standard five-field cron. */
  cron: string
  payload: Record<string, unknown>
}

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
  /**
   * Per-attempt backoff, when a doubling curve is not what the queue had.
   *
   * `events` is the reason this exists: its BullMQ `backoffStrategy` runs two
   * fast retries in seconds and then three jittered hourly ones, so an endpoint
   * in a real outage still receives the delivery ~7 hours later. A geometric
   * curve from 5s reaches 40s and calls it dead.
   */
  backoffMs?: (attemptsMade: number) => number
  /**
   * How many jobs from this queue may run at once, in this process.
   *
   * This is the reference's per-`Worker` `concurrency`, and it is the reason
   * the job worker runs a bounded pool rather than a serial drain — see runner.ts.
   * `workflow-dispatch` pins 1 deliberately: it is a global FIFO.
   */
  concurrency?: number
  /** How long succeeded rows are kept. Defaults to the process-wide setting. */
  retentionMs?: number
  /**
   * How long failed rows are kept. Defaults to `retentionMs`.
   *
   * Separate because the reference's split was deliberate: a queue kept its
   * successful traffic for a day and its failures for a month, so
   * *"did this webhook actually fire?"* stays answerable.
   */
  failedRetentionMs?: number
  /** Cron schedule that enqueues this job. Absent for jobs enqueued on demand. */
  cron?: string
  /**
   * Gate on `cron`, evaluated per tick. A false answer means the schedule is
   * inert — no row is written — rather than the job being enqueued and the
   * handler returning early, which would fill the table with no-ops.
   *
   * Resolve it through the same module the handler comes from: priming has
   * already imported that module outside any workspace scope, so the `import()`
   * here is a registry hit rather than a module executing under one workspace.
   */
  cronEnabled?: () => Promise<boolean>
  /** Schedules read from the workspace's database at tick time. */
  dynamicSchedules?: () => Promise<readonly DynamicSchedule[]>
  /**
   * Called after a failed attempt, with whether that failure was final.
   *
   * The reference expressed these as `worker.on('failed')` listeners, and one
   * of them is load-bearing: the webhook auto-disable counter must increment
   * **only** on permanent failure, or a flaky endpoint disables itself after
   * ~17 events instead of 50. Errors thrown here are logged, never rethrown —
   * the job's own outcome is already decided.
   */
  onFailure?: (job: ClaimedJob, error: unknown, permanent: boolean) => Promise<void>
}

/**
 * A failure the handler knows a retry cannot fix — the reference's
 * `UnrecoverableError`. Fails the job terminally on the spot, whatever attempts
 * remain.
 */
export class TerminalJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalJobError'
  }
}

/**
 * True for the errors that must not be retried.
 *
 * Also matches BullMQ's own `UnrecoverableError` by name, because handlers
 * moved off BullMQ call into services that still throw it (help-center
 * translate's unknown-type branch, the segment evaluator's deleted-segment
 * branch). Matching by name rather than by `instanceof` avoids importing
 * `bullmq` into the Postgres tier purely to identify an error class.
 */
export function isTerminalJobError(err: unknown): boolean {
  if (err instanceof TerminalJobError) return true
  return (err as { name?: unknown } | null)?.name === 'UnrecoverableError'
}

/** Defaults chosen to match what the BullMQ workers used. */
export const DEFAULT_LEASE_MS = 60_000
export const DEFAULT_RETRY_BACKOFF_MS = 5_000
/** BullMQ's own default `concurrency`. */
export const DEFAULT_CONCURRENCY = 1

const DAY_MS = 86_400_000

/**
 * Every queue in the process (SAAS-HOSTING-STACK.md §7.1).
 *
 * The first seven were BullMQ repeatable jobs with `concurrency: 1`,
 * `attempts: 3`, exponential backoff from 5s, and a payload carrying nothing
 * but a discriminant. The remaining eight are the on-demand queues; each one's
 * `concurrency`, `maxAttempts`, backoff, lease and retention below are the
 * values its BullMQ `Worker` and `defaultJobOptions` carried, so the observable
 * cadence and failure behaviour do not move.
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
    // The cron stays per-minute and the gate is what changed, which is the whole
    // point: an SLA breach is still noticed within a minute of falling due, and
    // a workspace with no running clock no longer wakes its compute 1,440 times a
    // day to be told so. `deadlines.ts` explains why an interval was the wrong
    // knob and why this one cannot make anything later than it is today.
    name: 'sla-breach-sweep',
    cron: '* * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/sla/sla-breach-sweep-queue').then((m) => m.runSlaBreachSweep),
    // Same module as the handler, deliberately: one module owns both what this
    // queue does and when it has anything to do, so the gate cannot be primed
    // separately from the work it gates.
    cronEnabled: () =>
      import('@/lib/server/domains/sla/sla-breach-sweep-queue').then((m) =>
        m.isSlaBreachSweepDue()
      ),
  },
  {
    name: 'snooze-sweep',
    cron: '* * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/conversation/snooze-sweep-queue').then((m) => m.runSnoozeSweep),
    cronEnabled: () =>
      import('@/lib/server/domains/conversation/snooze-sweep-queue').then((m) =>
        m.isSnoozeSweepDue()
      ),
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
    // Bounds what quarantined inbound mail can cost. Deliberately offset from
    // the other daily sweeps rather than sharing 03:00 or 04:00: this one
    // cascades across a conversation's whole child graph, so it is the last
    // thing that should run concurrently with anon-sweep, which contends for
    // the same rows from the other direction.
    name: 'email-log-retention',
    cron: '0 6 * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/email/email-log.retention').then((m) => m.runEmailLogRetention),
  },
  {
    name: 'spam-retention',
    cron: '0 5 * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/conversation/spam-retention-queue').then(
        (m) => m.runSpamRetention
      ),
  },
  {
    // Verification is a claim about the present that only a schedule can keep
    // making. A customer's ownership record, DKIM CNAMEs or MAIL FROM MX can
    // disappear at any time, and every one of those failures is silent at the
    // provider: mail keeps leaving, less and less able to prove who sent it.
    // This demotes the row, which drops the workspace back to the platform
    // sender rather than letting it keep signing on one leg.
    //
    // Daily, and offset from the other daily sweeps: it is bounded by outbound
    // DNS and provider calls rather than by rows, so it should not share a
    // minute with the passes that are bounded by the database.
    name: 'sending-domain-recheck',
    cron: '20 6 * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/channel-accounts/sending-domain-recheck-queue').then(
        (m) => m.runSendingDomainRecheck
      ),
  },
  {
    name: 'analytics',
    cron: '0 * * * *',
    maxAttempts: 3,
    handler: () =>
      import('@/lib/server/domains/analytics/analytics-queue').then((m) => m.runAnalyticsRefresh),
  },

  // ── The eight moved off BullMQ (SAAS-HOSTING-STACK.md §7.1) ────────────────

  {
    // Was `{event-hooks}`. The highest-volume queue and the widest surface:
    // a custom retry curve, bulk enqueue with deterministic dedupe keys,
    // cancelable delayed jobs, and a permanent-failure side effect.
    name: 'events',
    concurrency: 5,
    maxAttempts: HOOK_RETRY_ATTEMPTS,
    backoffMs: (attemptsMade) => hookRetryDelayMs(attemptsMade),
    retentionMs: DAY_MS,
    failedRetentionMs: 30 * DAY_MS,
    handler: () => import('@/lib/server/events/hook-job').then((m) => m.runHookJob),
    onFailure: (job, error, permanent) =>
      import('@/lib/server/events/hook-job').then((m) => m.onHookJobFailure(job, error, permanent)),
  },
  {
    // Drains one job-owned outbox row. The row is written in emit()'s
    // transaction so rollback leaves nothing.
    name: 'event-dispatch',
    concurrency: 5,
    maxAttempts: 10,
    retentionMs: DAY_MS,
    failedRetentionMs: 30 * DAY_MS,
    handler: () =>
      import('@/lib/server/events/event-dispatch-queue').then((m) => m.runEventDispatch),
  },
  {
    // Was `{segment-evaluation}`. Its schedules are rows in the workspace's own
    // `segments` table, so they are derived per tick rather than registered.
    name: 'segment-evaluation',
    concurrency: 2,
    maxAttempts: 3,
    retryBackoffMs: 2_000,
    retentionMs: DAY_MS,
    failedRetentionMs: 7 * DAY_MS,
    dynamicSchedules: () =>
      import('@/lib/server/events/segment-scheduler').then((m) => m.segmentEvaluationSchedules()),
    handler: () =>
      import('@/lib/server/events/segment-scheduler').then((m) => m.runSegmentEvaluation),
  },
  {
    // Was `{help-center-translate}`. The 120s lease is the case §7.2 was built
    // for, and the reason this tier runs a bounded pool instead of one serial
    // drain — see runner.ts.
    name: 'help-center-translate',
    concurrency: 1,
    maxAttempts: 3,
    retryBackoffMs: 5_000,
    leaseMs: 120_000,
    retentionMs: DAY_MS,
    failedRetentionMs: 14 * DAY_MS,
    handler: () =>
      import('@/lib/server/domains/help-center/help-center-translate-queue').then(
        (m) => m.runHelpCenterTranslate
      ),
  },
  {
    // Was `{email-imap}`, a 60s repeatable poll. `cronEnabled` keeps the
    // schedule inert unless an IMAP mailbox is actually configured, which is
    // what the reference achieved by never constructing the worker.
    name: 'email-imap',
    cron: '* * * * *',
    concurrency: 1,
    maxAttempts: 1,
    retentionMs: DAY_MS,
    failedRetentionMs: DAY_MS,
    cronEnabled: () =>
      import('@/lib/server/domains/conversation/conversation.email-imap-queue').then((m) =>
        m.isEmailImapPollable()
      ),
    handler: () =>
      import('@/lib/server/domains/conversation/conversation.email-imap-queue').then(
        (m) => m.runEmailImapPoll
      ),
  },
  {
    // Was `{workflow-dispatch}`. `concurrency: 1` is a deliberate global FIFO,
    // not a throughput default — two events on one conversation (a reply then
    // a close) are two jobs, and only a serial queue keeps their dispatch in
    // enqueue order.
    name: 'workflow-dispatch',
    concurrency: 1,
    maxAttempts: 3,
    retryBackoffMs: 1_000,
    retentionMs: DAY_MS,
    failedRetentionMs: 30 * DAY_MS,
    handler: () =>
      import('@/lib/server/domains/workflows/workflow-dispatch-queue').then(
        (m) => m.runWorkflowDispatch
      ),
  },
  {
    // Was `{workflow-wait}`. Delayed by construction: the row's `run_at` is the
    // wait's fire time, so a parked run costs one row rather than a live timer.
    name: 'workflow-wait',
    concurrency: 4,
    maxAttempts: 3,
    retryBackoffMs: 5_000,
    retentionMs: 7 * DAY_MS,
    failedRetentionMs: 7 * DAY_MS,
    handler: () =>
      import('@/lib/server/domains/workflows/workflow-wait-queue').then((m) => m.runWorkflowWait),
  },
  {
    // Was `{import}`. One attempt, deliberately: a retry re-runs the whole
    // batch and double-imports rows that already landed. This is the case the
    // reaper's terminal branch exists for.
    name: 'import',
    concurrency: 2,
    maxAttempts: 1,
    retentionMs: 7 * DAY_MS,
    failedRetentionMs: 14 * DAY_MS,
    handler: () =>
      import('@/lib/server/domains/import/import-queue').then((m) => m.runImportCommit),
  },
  {
    // Was `{export}`. One attempt for the same reason as import, and
    // concurrency 1 because an export is heavy and the single-active-run unique
    // index already allows only one.
    name: 'export',
    concurrency: 1,
    maxAttempts: 1,
    retentionMs: 7 * DAY_MS,
    failedRetentionMs: 14 * DAY_MS,
    handler: () =>
      import('@/lib/server/domains/export/export-queue').then((m) => m.runWorkspaceExport),
  },
  {
    // Pushes this workspace's team seats to the control plane. Cloud-only
    // work: the handler is a successful no-op without QUACKBACK_CONTROL_PLANE_URL.
    // Roster writes enqueue under a stable key (in-flight coalesces; a spent
    // row is cancelled first). The 15-minute cron is the missed-enqueue
    // backstop and stays inert without a control-plane URL.
    name: 'membership-sync',
    cron: '*/15 * * * *',
    concurrency: 1,
    maxAttempts: 10,
    retryBackoffMs: 15 * 60_000,
    cronEnabled: () =>
      import('@/lib/server/domains/principals/membership-sync-queue').then((m) =>
        m.isControlPlaneConfigured()
      ),
    handler: () =>
      import('@/lib/server/domains/principals/membership-sync-queue').then(
        (m) => m.runMembershipSync
      ),
  },
]

let overrides: readonly JobDefinition[] | null = null

/** The definitions the job worker will run. */
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

export function concurrencyFor(def: JobDefinition): number {
  return def.concurrency ?? DEFAULT_CONCURRENCY
}

/**
 * Backoff for the next attempt.
 *
 * The default doubles per attempt made, matching the BullMQ workers'
 * `{ type: 'exponential', delay: 5000 }`, which produced 5s, 10s, 20s. A
 * definition may supply its own curve instead — `events` does, because its
 * BullMQ `backoffStrategy` was not geometric.
 */
export function retryBackoffMs(def: JobDefinition, attemptsMade: number): number {
  if (def.backoffMs) return def.backoffMs(attemptsMade)
  const base = def.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS
  return base * Math.pow(2, Math.max(0, attemptsMade - 1))
}

/**
 * Per-queue, per-status retention windows for the pruner.
 *
 * Built from the definitions rather than kept as a second list, so a queue
 * cannot exist whose rows nothing prunes.
 */
export function retentionOverrides(): Record<string, { succeeded?: number; failed?: number }> {
  const out: Record<string, { succeeded?: number; failed?: number }> = {}
  for (const def of jobDefinitions()) {
    if (def.retentionMs === undefined && def.failedRetentionMs === undefined) continue
    out[def.name] = {
      succeeded: def.retentionMs,
      failed: def.failedRetentionMs ?? def.retentionMs,
    }
  }
  return out
}
