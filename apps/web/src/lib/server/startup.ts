/**
 * Startup banner -- logs build and runtime info once on first request.
 * Build-time constants are injected via Vite `define`; runtime info is read at call time.
 */
import { logger } from '@/lib/server/logger'
import { getProcessRole, shouldRunWorkers } from './process-role'
import { config, validateRuntimeConfig } from './config'

const log = logger.child({ component: 'startup' })

let _logged = false
let _shutdownWired = false

/**
 * Wire SIGTERM/SIGINT to drain the job tier and close the remaining Postgres
 * connections cleanly. A job left mid-flight is not lost — its lease lapses and
 * the reaper adjudicates it — but draining avoids abandoning work that was
 * seconds from finishing, and avoids double-billing an AI call.
 *
 * 30s overall budget — if a handler hangs (e.g. a 60s AI call), we force-exit
 * so the supervisor doesn't SIGKILL us mid-cleanup.
 */
function wireGracefulShutdown(): void {
  if (_shutdownWired) return
  _shutdownWired = true

  let inProgress = false
  const shutdown = (signal: string) => {
    if (inProgress) return
    inProgress = true
    log.info({ signal }, 'shutdown signal received, draining queues')

    // Hard timeout: if any close hangs, force-exit. The deadline starts
    // ticking the moment we receive the signal, not after closes resolve.
    const forceExit = setTimeout(() => {
      log.error({ timeout_ms: 30_000 }, 'shutdown timeout exceeded, force exiting')
      process.exit(1)
    }, 30_000)
    forceExit.unref?.()

    void (async () => {
      try {
        // Stop the Postgres job tier's loops and release its LISTEN
        // connections. Jobs already running are awaited within the budget
        // below; anything still in flight when the process dies is NOT
        // re-run blindly — its lease lapses and the reaper adjudicates it,
        // which for a no-retry job means terminal rather than a second run.
        await import('./jobs/tier').then(({ stopJobTier }) => stopJobTier())

        // Drain the conversation pub/sub subscriber connection before the
        // shared client closes — it's a separate long-lived socket.
        await import('./realtime/pubsub').then(({ closeSubscriber }) => closeSubscriber())

        clearTimeout(forceExit)
        log.info('shutdown complete')
        process.exit(0)
      } catch (err) {
        log.error({ err }, 'shutdown failed')
        process.exit(1)
      }
    })()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

/**
 * Run one cron job to completion, then exit with a status the platform can see.
 *
 * An unknown job name exits 1 rather than 0: a cron service pointed at a job
 * that no longer exists would otherwise report a green history forever while
 * sweeping nothing, which is the one failure mode a cron service really has.
 */
async function runCronJobAndExit(name: string): Promise<never> {
  const { isFleetCronJobName, runFleetCronJob, FLEET_CRON_JOBS } =
    await import('@/lib/server/cron/fleet-jobs')
  if (!isFleetCronJobName(name)) {
    log.error(
      { job: name, known: Object.keys(FLEET_CRON_JOBS) },
      'QUACKBACK_CRON_JOB names no known job'
    )
    process.exit(1)
  }
  const ok = await runFleetCronJob(name)
  process.exit(ok ? 0 : 1)
}

export function logStartupBanner(): void {
  // Build evaluation is explicitly selected by the build script. A missing
  // runtime secret must never be mistaken for build mode.
  if (process.env.QUACKBACK_BUILD === '1') return

  if (_logged) return
  validateRuntimeConfig()
  _logged = true

  const runtime =
    typeof globalThis.Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`
  const port = process.env.PORT ?? '3000'
  const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`

  log.info(
    {
      version: __APP_VERSION__,
      commit: __GIT_COMMIT__,
      runtime,
      port,
      base_url: baseUrl,
      role: getProcessRole(),
      built: __BUILD_TIME__,
    },
    'server started'
  )

  // A cron service is this same image with `QUACKBACK_CRON_JOB` set and a
  // `deploy.cronSchedule`: the platform starts the container, waits for it to
  // exit, and reports the exit code. So run the named job and exit — and start
  // none of the long-lived background work below, because a process holding a
  // job-tier session or an interval would never exit, and the platform would
  // report a cron run that "succeeded" by still running.
  const cronJob = process.env.QUACKBACK_CRON_JOB?.trim()
  if (cronJob) {
    void runCronJobAndExit(cronJob)
    return
  }

  // Surface a mail domain that names no domain, for the same reason as the AI
  // check below: the failure is otherwise entirely silent. Every reader treats
  // an unusable value as absent, which is the safe behaviour — nothing is minted
  // and inbound mail is deferred rather than bounced — and safe here means the
  // channel simply stops working with no line anywhere saying why. A stray comma
  // in the domain a cutover is being carried on is exactly the typo this catches.
  import('@/lib/server/domains/conversation/conversation.email-channel')
    .then(({ invalidInboundDomainValues }) => {
      for (const { variable, value } of invalidInboundDomainValues()) {
        log.error(
          { variable, value },
          'inbound mail domain names no usable domain, so it is being ignored: no reply ' +
            'address is minted on it and no mail is accepted for it'
        )
      }
    })
    .catch((err) => log.error({ err }, 'inbound mail domain validation failed'))

  // Surface half-configured AI loudly instead of failing silently (see #180).
  import('@/lib/server/domains/ai/config')
    .then(({ validateAiConfig }) => validateAiConfig())
    .catch((err) => log.error({ err }, 'ai config validation failed'))

  // Reads the workspace's integration rows, so it is per-database work. Under
  // pooled tenancy it runs once per workspace — and, like the startup backfill
  // below, only on a replica that already does background work, because a
  // fleet-wide read on every web boot would wake every suspended compute.
  //
  // This one was found by the `db` proxy's own scope tripwire rather than by the
  // sweep that preceded it: it is a boot-time configuration warning, which is
  // not where anyone looks for a database query.
  if (config.isPooledTenancy && !shouldRunWorkers()) {
    log.info(
      'pooled tenancy on a web replica — integration config validation runs on the worker tier'
    )
  } else {
    Promise.all([
      import('@/integrations/segment/server/user-sync'),
      import('@/lib/server/workspaces/fleet'),
    ])
      .then(([{ warnIfSegmentInboundIsInsecure }, { runFleetPass }]) =>
        runFleetPass('sweep', () => warnIfSegmentInboundIsInsecure())
      )
      .catch((err) => log.error({ err }, 'failed to validate Segment inbound configuration'))
  }

  // Wire SIGTERM/SIGINT once — the rest of this function spawns
  // long-lived workers + sweepers, so register the drain handler before
  // any of them start so a fast Ctrl-C in dev still gets a clean exit.
  wireGracefulShutdown()

  // One-time in-place data backfills (idempotent, advisory-locked). Runs the
  // custom-oidc → identity_provider migration that needs SECRET_KEY to decrypt
  // its credential and so can't live in the SQL migration bundle.
  //
  // Per-database work, so under pooled tenancy it runs once per workspace — but
  // only on a replica that already runs background work. A fleet-wide backfill
  // on every web boot would open a connection to every workspace database and wake
  // every suspended compute, which is precisely the cost the pooling exists to
  // avoid; one-shot per-database work belongs with the migrator role. The
  // backfill is idempotent and advisory-locked, which is what makes fanning it
  // out safe rather than merely convenient.
  if (config.isPooledTenancy && !shouldRunWorkers()) {
    log.info('pooled tenancy on a web replica — startup backfills are left to the worker tier')
  } else {
    Promise.all([
      import('@/lib/server/auth/backfill-custom-oidc-provider'),
      import('@/lib/server/workspaces/fleet'),
    ])
      .then(([{ runStartupBackfills }, { runFleetPass }]) =>
        runFleetPass('sweep', () => runStartupBackfills())
      )
      .catch((err) => log.error({ err }, 'failed to run startup backfills'))
  }

  // Quackback config file watcher — reconciles managed fields from
  // /etc/quackback/config.yaml on every change. No-op when the file
  // is absent (self-host default).
  //
  // Deliberately NOT started under pooled tenancy. The mechanism is a single
  // file at a single path with no workspace parameter anywhere in `ReconcileDeps`,
  // and you cannot mount N files at one path — so it has to be replaced by a
  // workspace-keyed entrypoint behind an authenticated control-plane route, not
  // adapted. Starting it here would reconcile whichever workspace the fleet pass
  // happened to visit with one file's contents (SAAS-HOSTING-STACK.md §8).
  if (config.isPooledTenancy) {
    log.info(
      'pooled tenancy — the /etc/quackback/config.yaml watcher is not started; ' +
        'per-workspace config arrives through the control plane'
    )
  } else {
    import('@/lib/server/config-file')
      .then(({ startQuackbackConfigWatcher }) => startQuackbackConfigWatcher())
      .catch((err) => log.error({ err }, 'failed to start config-file watcher'))
  }

  // Background processing is role-gated: QUACKBACK_ROLE=web replicas serve
  // HTTP and enqueue only, so scaling them never scales queue consumption.
  if (shouldRunWorkers()) {
    startBackgroundProcessing()
  } else {
    // Web replicas write domain events and enqueue jobs but do NOT claim them.
    // Since EVENTING-V2's cutover made the job-owned outbox the SOLE delivery
    // path, a deployment that scales web replicas MUST also run at least one
    // worker-role (or 'all') replica, or every webhook / notification /
    // workflow will pile up unpublished. Warn (not info) so a web-only
    // topology is loud in the logs.
    log.warn(
      'QUACKBACK_ROLE=web — queue workers are worker-side; ' +
        'ensure a worker (or role=all) replica is running or events will not be delivered'
    )
  }
}

/**
 * Boot the background tiers, and — on a single-workspace install only — the
 * periodic sweepers. Runs under QUACKBACK_ROLE=worker and the single-process
 * default ('all'), never on web-role replicas. Every sweeper additionally holds
 * a cross-instance sweep lock, so multiple worker replicas stay safe.
 *
 * Under pooled tenancy this starts the job tier and stops there: the sweeps
 * run on cron services instead, for the reason stated at the branch below.
 */
function startBackgroundProcessing(): void {
  // The Postgres job tier — every background queue in the process. It runs
  // under BOTH tenancy modes, because a job row lives in the workspace's own
  // database and the tier opens a real workspace scope around every claim. Those
  // are exactly the two properties BullMQ lacked: a Redis job carries no
  // workspace, so its processor resolved `db` with no scope and threw on its first
  // query, and one un-namespaced Redis list per queue held every workspace's
  // payloads.
  //
  // The periodic sweepers below funnel through `withSweepLock`, which fans a
  // tick out across the fleet with a real workspace scope each time — which is why
  // a pooled worker does not arm them at all; see the branch below.
  import('./jobs/tier')
    .then(({ startJobTier }) => startJobTier())
    .catch((err) => log.error({ err }, 'failed to start the job tier'))

  // Boot-time page_views partition ensure. This used to ride along inside the
  // BullMQ queue's construction; it needs a real workspace scope now, so it runs as
  // a fleet pass instead. It stays at boot rather than waiting for the 02:30
  // slot because beacons are dropped while a day has no partition, and an
  // instance that was down long enough to exhaust its week-ahead window would
  // otherwise lose a day of them.
  Promise.all([
    import('./domains/analytics/partition-maintenance-queue'),
    import('@/lib/server/workspaces/fleet'),
  ])
    .then(([{ ensurePageViewPartitionsAtBoot }, { runFleetPass }]) =>
      runFleetPass('sweep', () => ensurePageViewPartitionsAtBoot())
    )
    .catch((err) => log.error({ err }, 'boot-time partition ensure failed'))

  // The job tier above is everything a pooled worker runs, and the timers
  // below are the reason there is a branch here at all.
  //
  // Every one of them funnels through `withSweepLock`, which under pooled
  // tenancy fans the tick out across the WHOLE fleet — one connection to every
  // workspace database, per tick. So the interval stops being a scheduling
  // preference and becomes the floor on how often every suspended workspace
  // compute is woken, and the 5-minute reconcilers sit almost exactly on the
  // 300 s (measured 337 s) suspend timeout: the compute is woken at very nearly
  // the rate it would otherwise sleep, with no functional symptom at all. That
  // is the same shape as a poll loop, only slower.
  //
  // So under pooled tenancy they move off this process entirely, onto
  // `deploy.cronSchedule` services that run one job and exit
  // (`cron/fleet-jobs.ts`, SAAS-HOSTING-STACK.md §9). The bodies are the same
  // functions this branch calls below — only the trigger differs — which leaves
  // the always-warm worker holding the job tier and nothing else.
  //
  // There is deliberately no BullMQ branch left. It used to hold a warning and
  // an eager worker boot, refused under pooled tenancy because a Redis job
  // carries no workspace; every queue is now a table in the workspace's own database,
  // drained by the job tier above.
  if (config.isPooledTenancy) {
    log.info(
      'pooled tenancy — the scheduled sweeps are not on this process. They fan out across the ' +
        'whole fleet, so their intervals would set the rate at which every suspended workspace ' +
        'compute is woken; they run on the cron services instead (cron/fleet-jobs.ts)'
    )
    return
  }

  // The scheduled sweeps. Each body lives in `cron/fleet-jobs.ts` so this
  // single-workspace schedule and the pooled fleet's cron services run the same
  // code; only the trigger differs. The delays and intervals here are the ones
  // these sweeps have always had.
  import('@/lib/server/cron/fleet-jobs')
    .then((jobs) => {
      // Space reclamation for the tables that replaced Redis (kv_store,
      // rate_bucket, kv_set_member, presence_stream, realtime_overflow).
      // Hourly rather than daily because rate buckets churn per request.
      setTimeout(() => void jobs.runKvSweep(), 45_000)
      setInterval(() => void jobs.runKvSweep(), 60 * 60 * 1000)

      // Daily maintenance: audit prune, invite sweep, outbox retention, logs.
      setTimeout(() => void jobs.runDailyMaintenance(), 30_000)
      setInterval(() => void jobs.runDailyMaintenance(), 24 * 60 * 60 * 1000)

      // Stale/missing post summaries. AI calls are expensive, so the sweep lock
      // keeps it to one replica per tick. 5s delay lets other startup finish.
      setTimeout(() => void jobs.runSummarySweep(), 5_000)
      setInterval(() => void jobs.runSummarySweep(), 30 * 60 * 1000)

      // Duplicate-post detection. 15s delay staggers after summary's 5s.
      setTimeout(() => void jobs.runMergeSweep(), 15_000)
      setInterval(() => void jobs.runMergeSweep(), 30 * 60 * 1000)

      // Changelog publish-notification reconciler: announces any live entry
      // whose notification was missed (a dropped delayed-publish job, or a
      // dispatch that failed after the synchronous publish).
      setTimeout(() => void jobs.runChangelogNotifyReconcile(), 25_000)
      setInterval(() => void jobs.runChangelogNotifyReconcile(), 5 * 60 * 1000)

      // Same shape, for status_incidents.notified_at.
      setTimeout(() => void jobs.runStatusNotifyReconcile(), 28_000)
      setInterval(() => void jobs.runStatusNotifyReconcile(), 5 * 60 * 1000)

      // Scheduled-maintenance boot sweep: catches window start/complete
      // transitions missed while the process was down. Each handler is
      // idempotent, so overlap with a live delayed job is harmless.
      setTimeout(() => void jobs.runStatusMaintenanceSweep(), 31_000)
      setInterval(() => void jobs.runStatusMaintenanceSweep(), 5 * 60 * 1000)
    })
    .catch((err) => log.error({ err }, 'failed to init the scheduled sweeps'))
}
