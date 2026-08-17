/**
 * The scheduled sweeps, as jobs a Railway cron service runs and exits from.
 *
 * SAAS-HOSTING-STACK.md §9: *"`deploy.cronSchedule` — Railway runs a service on
 * a cron and lets it exit. The daily and hourly sweeps belong here rather than
 * on `setInterval` inside an always-warm worker. Keep the always-warm worker
 * only for what needs a live `LISTEN` connection."*
 *
 * ## Why this is not merely tidier
 *
 * Under pooled tenancy every one of these sweeps funnels through
 * `withSweepLock`, which fans the tick out across the **whole fleet** — one
 * connection to every workspace database per tick. So the interval is not a
 * scheduling preference, it is the floor on how often every suspended Neon
 * compute is woken:
 *
 * | Timer in `startup.ts` | Fan-out interval | Against a 300 s suspend timeout |
 * | --- | --- | --- |
 * | changelog / status / maintenance reconcilers | 5 min | **no workspace ever suspends** |
 * | summary + merge sweeps | 30 min | wakes every workspace twice an hour |
 * | kv sweep, telemetry claim | 1 h | wakes every workspace hourly |
 * | daily audit maintenance | 24 h | fine |
 *
 * The 5-minute row is the one that matters: 300 s of fan-out against a 300 s
 * (measured 337 s) suspend timeout means the compute is woken at almost exactly
 * the rate it would otherwise sleep, and the whole idle-cost model is gone with
 * no functional symptom at all. That is the same shape as the job tier's
 * 1-second poll, only slower — and it is why a pooled worker tier runs none of
 * these timers.
 *
 * ## The tradeoff, stated
 *
 * Moving the reconcilers from 5 minutes to hourly is a real reduction in
 * timeliness for a pooled fleet. They are
 * backstops — the primary paths are a synchronous publish, a delayed job and a
 * provider webhook — so what lengthens is the recovery window after a dropped
 * delivery, not the normal case. Nothing changes for a single-workspace install:
 * `startup.ts` keeps its original timers there, calling exactly these functions.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'fleet-cron' })

const TEN_MIN = 10 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000
const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000

/**
 * Space reclamation for the tables that replaced Redis (`kv_store`,
 * `rate_bucket`, `kv_set_member`, `presence_stream`, `realtime_overflow`).
 *
 * Hourly rather than daily because rate buckets churn per request: a busy
 * install writes one row per limiter per window. Nothing here is load-bearing —
 * every read filters on expiry, so a missed sweep costs disk rather than
 * correctness (see `kv/sweep.ts`).
 */
export async function runKvSweep(): Promise<void> {
  const [{ sweepExpiredKv }, { withSweepLock }] = await Promise.all([
    import('@/lib/server/kv/sweep'),
    import('@/lib/server/sweep-lock'),
  ])
  await withSweepLock('kv_sweep', ONE_HOUR, async () => {
    await sweepExpiredKv().catch((err) => log.error({ err }, 'kv sweep failed'))
  })
}

/**
 * Audit-log retention, expired portal/team invites, outbox retention and the
 * log/telemetry retention group. TTLs are generous — each sweeper takes < 1 s,
 * and a slow database should not cause premature expiry.
 */
export async function runDailyMaintenance(): Promise<void> {
  const [
    { pruneAuditLog },
    { sweepExpiredPortalInvites },
    { pruneEventsOutbox },
    { cleanupExpiredLogs },
    { cleanupExpiredToolCalls, cleanupExpiredAssistantEvents },
    { cleanupExpiredMessageTranslations },
    { withSweepLock },
  ] = await Promise.all([
    import('@/lib/server/audit/log'),
    import('@/lib/server/audit/invite-sweep'),
    import('@/lib/server/events/events-sweep'),
    import('@/lib/server/domains/ai/usage-log'),
    import('@/lib/server/domains/assistant/tool-audit'),
    import('@/lib/server/domains/conversation/conversation-translation.service'),
    import('@/lib/server/sweep-lock'),
  ])

  await withSweepLock('audit_prune', ONE_HOUR, async () => {
    await pruneAuditLog().catch((err) => log.error({ err }, 'audit-log prune failed'))
  })
  await withSweepLock('invite_sweep', ONE_HOUR, async () => {
    await sweepExpiredPortalInvites().catch((err) => log.error({ err }, 'invite sweep failed'))
  })
  // EVENTING-V2 outbox retention (WO-20): prune published rows past the window;
  // unpublished rows are never touched.
  await withSweepLock('events_prune', ONE_HOUR, async () => {
    await pruneEventsOutbox().catch((err) => log.error({ err }, 'events outbox prune failed'))
  })
  // ai_usage_log + operational tables (hook deliveries, unsubscribe tokens,
  // in-app notifications), assistant tool-audit + events, message translations.
  await withSweepLock('logs_retention', ONE_HOUR, async () => {
    await Promise.all([
      cleanupExpiredLogs(),
      cleanupExpiredToolCalls(),
      cleanupExpiredAssistantEvents(),
      cleanupExpiredMessageTranslations(),
    ]).catch((err) => log.error({ err }, 'logs retention cleanup failed'))
  })
}

/** Stale/missing post summaries. AI calls, so one replica per tick. */
export async function runSummarySweep(): Promise<void> {
  const [{ refreshStaleSummaries }, { withSweepLock }] = await Promise.all([
    import('@/lib/server/domains/summary/summary.service'),
    import('@/lib/server/sweep-lock'),
  ])
  await withSweepLock('summary_sweep', ONE_HOUR, () =>
    refreshStaleSummaries().catch((err) => log.error({ err }, 'summary sweep failed'))
  )
}

/** Duplicate-post detection. AI calls and user-visible output; same shape. */
export async function runMergeSweep(): Promise<void> {
  const [{ sweepMergeSuggestions }, { withSweepLock }] = await Promise.all([
    import('@/lib/server/domains/merge-suggestions/merge-check.service'),
    import('@/lib/server/sweep-lock'),
  ])
  await withSweepLock('merge_sweep', ONE_HOUR, () =>
    sweepMergeSuggestions().catch((err) => log.error({ err }, 'merge suggestion sweep failed'))
  )
}

/** Announces any live changelog entry whose notification was missed. */
export async function runChangelogNotifyReconcile(): Promise<void> {
  const [{ reconcileChangelogNotifications }, { withSweepLock }] = await Promise.all([
    import('@/lib/server/domains/changelog/changelog.service'),
    import('@/lib/server/sweep-lock'),
  ])
  await withSweepLock('changelog_notify', TEN_MIN, async () => {
    await reconcileChangelogNotifications().catch((err) =>
      log.error({ err }, 'changelog notify reconcile failed')
    )
  })
}

/** Same shape, for `status_incidents.notified_at` (Status Product Spec §9). */
export async function runStatusNotifyReconcile(): Promise<void> {
  const [{ reconcileStatusNotifications }, { withSweepLock }] = await Promise.all([
    import('@/lib/server/domains/status/status.service'),
    import('@/lib/server/sweep-lock'),
  ])
  await withSweepLock('status_notify', TEN_MIN, async () => {
    await reconcileStatusNotifications().catch((err) =>
      log.error({ err }, 'status notify reconcile failed')
    )
  })
}

/** Window start/complete transitions missed while the process was down. */
export async function runStatusMaintenanceSweep(): Promise<void> {
  const [{ reconcileMaintenanceWindows }, { withSweepLock }] = await Promise.all([
    import('@/lib/server/domains/status/status.maintenance'),
    import('@/lib/server/sweep-lock'),
  ])
  await withSweepLock('status_maintenance_sweep', TEN_MIN, async () => {
    await reconcileMaintenanceWindows().catch((err) =>
      log.error({ err }, 'status maintenance window reconcile failed')
    )
  })
}

/**
 * Migrator convergence for the housekeeping job: enrol, then one reconcile
 * pass with the CLI defaults (concurrency 4, lease 900_000 ms).
 *
 * Concurrent safety with a CP-triggered run is the `cp_workspace_schema_state`
 * lease — enrol and reconcile claim through that table, so this pass and a
 * control-plane spawn cannot migrate the same workspace at once.
 */
async function runMigratorConvergence(): Promise<void> {
  const [{ enrolActiveWorkspaces, runReconcilePass }, { hostname }, { randomUUID }] =
    await Promise.all([
      import('@/lib/server/fleet/migrator'),
      import('node:os'),
      import('node:crypto'),
    ])
  const enrolled = await enrolActiveWorkspaces()
  const result = await runReconcilePass({
    workerId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
    concurrency: 4,
    leaseMs: 900_000,
  })
  log.info(
    {
      enrolled,
      claimed: result.claimed,
      reconciled: result.reconciled,
      failed: result.failed,
      already_current: result.alreadyCurrent,
      healed: result.healed,
    },
    'fleet migrator pass complete'
  )
  if (result.failed > 0) {
    throw new Error(`fleet migrator failed ${result.failed} workspace(s)`)
  }
}

/**
 * The cron jobs a service can name via `QUACKBACK_CRON_JOB`.
 *
 * `hourly` and `daily` stay as ad-hoc / rollback entry points. `housekeeping`
 * is the live hourly service: the six hourly bodies, then the daily set +
 * telemetry once per 23 h window, then migrator convergence.
 *
 * There is no outbox backstop here. `emit()` writes an `event-dispatch` job in
 * the same transaction as the outbox row, and the job tier drains it — so an
 * event whose NOTIFY was lost is picked up by the poll floor, not an hour later
 * by a sweep. A cron pass over every workspace's outbox would be a second
 * drainer racing the job claim for no reachable failure.
 *
 * Serial rather than concurrent: each of these already fans out across the whole
 * fleet, and running the seven at once would open seven connections to every
 * workspace database instead of one.
 */
export const FLEET_CRON_JOBS = {
  daily: async () => {
    await runDailyMaintenance()
    const { startTelemetry } = await import('@/lib/server/telemetry')
    await startTelemetry({ once: true })
  },
  hourly: async () => {
    await runKvSweep()
    await runSummarySweep()
    await runMergeSweep()
    await runChangelogNotifyReconcile()
    await runStatusNotifyReconcile()
    await runStatusMaintenanceSweep()
  },
  housekeeping: async () => {
    await FLEET_CRON_JOBS.hourly()
    const { withSweepLock } = await import('@/lib/server/sweep-lock')
    // Same bodies as `daily`, claimed once per 23 h so an hourly tick does
    // not re-run retention + telemetry. Pattern matches `telemetry_ping`.
    await withSweepLock('daily_cycle', TWENTY_THREE_HOURS, () => FLEET_CRON_JOBS.daily(), {
      keepUntilExpiry: true,
    })
    await runMigratorConvergence()
  },
} as const

export type FleetCronJobName = keyof typeof FLEET_CRON_JOBS

export function isFleetCronJobName(value: string): value is FleetCronJobName {
  return Object.hasOwn(FLEET_CRON_JOBS, value)
}

/**
 * Run one job and report whether it completed.
 *
 * The caller exits the process on the result. A cron service that exited 0 on a
 * failed sweep would report a green cron history over a fleet that has stopped
 * sweeping, which is the only failure mode a cron service really has.
 */
export async function runFleetCronJob(name: FleetCronJobName): Promise<boolean> {
  const startedAt = Date.now()
  log.info({ job: name }, 'fleet cron job starting')
  try {
    await FLEET_CRON_JOBS[name]()
    log.info({ job: name, duration_ms: Date.now() - startedAt }, 'fleet cron job complete')
    return true
  } catch (err) {
    log.error({ err, job: name, duration_ms: Date.now() - startedAt }, 'fleet cron job failed')
    return false
  }
}
