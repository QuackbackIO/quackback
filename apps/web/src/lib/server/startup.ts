/**
 * Startup banner -- logs build and runtime info once on first request.
 * Build-time constants are injected via Vite `define`; runtime info is read at call time.
 */
import { logger } from '@/lib/server/logger'
import { closeAllWorkers, initAllWorkers } from './queue/worker-registry'
import { getProcessRole, shouldRunWorkers } from './queue/role'
import { config, validateRuntimeConfig } from './config'

const log = logger.child({ component: 'startup' })

let _logged = false
let _shutdownWired = false

/**
 * Wire SIGTERM/SIGINT to gracefully drain BullMQ queues + workers and
 * close the shared Redis connection. BullMQ's stalled-job checker
 * recovers any in-flight jobs on the next startup, but shutting down
 * cleanly avoids spurious "stalled" reports and double-billing on
 * AI/webhook handlers that are mid-flight.
 *
 * 30s overall budget — if any worker hangs (e.g. a 60s OpenAI call),
 * we force-exit so k8s/systemd doesn't SIGKILL us mid-cleanup.
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
        // Stop the relay before closing BullMQ/Redis so a final poll cannot
        // enqueue into a queue that is already draining.
        await import('./events/relay').then(({ stopOutboxRelay }) => stopOutboxRelay())

        // Stop the Postgres job tier's loops and release its LISTEN
        // connections. In-flight jobs are NOT cancelled: their leases simply
        // lapse and the reaper adjudicates them on the next boot, which is the
        // whole point of the lease — a job with no attempts left goes terminal
        // rather than running a second time.
        await import('./jobs/tier').then(({ stopJobTier }) => stopJobTier())

        // Drain every registered queue/worker. One list drives boot and
        // shutdown, so nothing can be booted but left undrained.
        await closeAllWorkers()

        // Drain the conversation pub/sub subscriber connection before the
        // shared client closes — it's a separate long-lived socket.
        await import('./realtime/pubsub').then(({ closeSubscriber }) => closeSubscriber())

        // After all queues + workers have closed, quit the shared
        // IORedis client so we don't leave a half-open socket behind.
        await import('./queue/redis-config').then(({ closeQueueRedis }) => closeQueueRedis())

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

  // Surface half-configured AI loudly instead of failing silently (see #180).
  import('@/lib/server/domains/ai/config')
    .then(({ validateAiConfig }) => validateAiConfig())
    .catch((err) => log.error({ err }, 'ai config validation failed'))

  // Reads the tenant's integration rows, so it is per-database work. Under
  // pooled tenancy it runs once per tenant — and, like the startup backfill
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
      import('@/lib/server/tenancy/fleet'),
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
  // Per-database work, so under pooled tenancy it runs once per tenant — but
  // only on a replica that already runs background work. A fleet-wide backfill
  // on every web boot would open a connection to every tenant database and wake
  // every suspended compute, which is precisely the cost the pooling exists to
  // avoid; one-shot per-database work belongs with the migrator role. The
  // backfill is idempotent and advisory-locked, which is what makes fanning it
  // out safe rather than merely convenient.
  if (config.isPooledTenancy && !shouldRunWorkers()) {
    log.info('pooled tenancy on a web replica — startup backfills are left to the worker tier')
  } else {
    Promise.all([
      import('@/lib/server/auth/backfill-custom-oidc-provider'),
      import('@/lib/server/tenancy/fleet'),
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
  // file at a single path with no tenant parameter anywhere in `ReconcileDeps`,
  // and you cannot mount N files at one path — so it has to be replaced by a
  // tenant-keyed entrypoint behind an authenticated control-plane route, not
  // adapted. Starting it here would reconcile whichever tenant the fleet pass
  // happened to visit with one file's contents (SAAS-HOSTING-STACK.md §8).
  if (config.isPooledTenancy) {
    log.info(
      'pooled tenancy — the /etc/quackback/config.yaml watcher is not started; ' +
        'per-tenant config arrives through the control plane'
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
    // Web replicas write domain events to the durable outbox but do NOT drain it
    // — the relay runs worker-side only. Since EVENTING-V2's cutover made the
    // outbox the SOLE delivery path, a deployment that scales web replicas MUST
    // also run at least one worker-role (or 'all') replica, or every webhook /
    // notification / workflow will pile up unpublished. Warn (not info) so a
    // web-only topology is loud in the logs.
    log.warn(
      'QUACKBACK_ROLE=web — queue workers and the outbox relay are worker-side; ' +
        'ensure a worker (or role=all) replica is running or events will not be delivered'
    )
  }
}

/**
 * Boot queue workers and periodic sweepers. Runs under QUACKBACK_ROLE=worker
 * and the single-process default ('all') — never on web-role replicas. Every
 * sweeper additionally holds a cross-instance sweep lock, so multiple worker
 * replicas stay safe.
 */
function startBackgroundProcessing(): void {
  // The queue tier and the outbox relay do NOT run under pooled tenancy, and
  // this refusal is deliberate rather than unfinished work.
  //
  // A BullMQ job carries no tenant, so every processor would resolve `db` with
  // no scope and throw on its first query — a per-job failure is a far worse
  // signal than one loud refusal at boot. The relay is worse still: it needs a
  // session-mode connection for `LISTEN` and `pg_advisory_lock`, and a
  // transaction pooler drops the registration in proportion to contention, so a
  // single-client smoke test passes while a busy fleet silently stops receiving
  // wakes. Both need per-tenant direct connections on a separate always-warm
  // tier (SAAS-HOSTING-STACK.md §7.3), which is a different piece of work.
  //
  // The periodic sweepers below DO run: they funnel through `withSweepLock`,
  // which fans a tick out across the fleet with a real tenant scope each time.
  // The Postgres job tier. Unlike BullMQ it runs under BOTH tenancy modes,
  // because a job row lives in the tenant's own database and the tier opens a
  // real tenant scope around every claim — the two properties whose absence is
  // why the BullMQ tier below still refuses to start pooled.
  import('./jobs/tier')
    .then(({ startJobTier }) => startJobTier())
    .catch((err) => log.error({ err }, 'failed to start the job tier'))

  // Boot-time page_views partition ensure. This used to ride along inside the
  // BullMQ queue's construction; it needs a real tenant scope now, so it runs as
  // a fleet pass instead. It stays at boot rather than waiting for the 02:30
  // slot because beacons are dropped while a day has no partition, and an
  // instance that was down long enough to exhaust its week-ahead window would
  // otherwise lose a day of them.
  Promise.all([
    import('./domains/analytics/partition-maintenance-queue'),
    import('@/lib/server/tenancy/fleet'),
  ])
    .then(([{ ensurePageViewPartitionsAtBoot }, { runFleetPass }]) =>
      runFleetPass('sweep', () => ensurePageViewPartitionsAtBoot())
    )
    .catch((err) => log.error({ err }, 'boot-time partition ensure failed'))

  if (config.isPooledTenancy) {
    log.warn(
      'pooled tenancy — the remaining BullMQ queue workers and the outbox relay are NOT ' +
        'started. They require per-tenant session-mode connections on a dedicated tier; ' +
        'events will accumulate in each tenant outbox until that tier runs.'
    )
  } else {
    // Boot every eagerly-initialized queue worker from the registry. Each init
    // is isolated: one failure is logged without blocking the rest.
    initAllWorkers()

    // Durable event outbox relay (EVENTING-V2 WO-3). Leader-elected, so multiple
    // worker replicas stay safe. Post-cutover (WO-18) the outbox is the SOLE
    // delivery path, so the relay always runs here — the only gate is
    // QUACKBACK_ROLE (worker/all), enforced inside startOutboxRelay().
    import('./events/relay')
      .then(({ startOutboxRelay }) => startOutboxRelay())
      .catch((err) => log.error({ err }, 'failed to start outbox relay'))
  }

  // Audit-log retention sweep + expired portal/team invite sweep.
  // Daily maintenance runs under a cross-instance lock so only one
  // replica executes per tick in multi-instance deployments.
  Promise.all([
    import('@/lib/server/audit/log'),
    import('@/lib/server/audit/invite-sweep'),
    import('./events/events-sweep'),
    import('./domains/ai/usage-log'),
    import('./domains/assistant/tool-audit'),
    import('./domains/conversation/conversation-translation.service'),
    import('@/lib/server/sweep-lock'),
  ])
    .then(
      ([
        { pruneAuditLog },
        { sweepExpiredPortalInvites },
        { pruneEventsOutbox },
        { cleanupExpiredLogs },
        { cleanupExpiredToolCalls, cleanupExpiredAssistantEvents },
        { cleanupExpiredMessageTranslations },
        { withSweepLock },
      ]) => {
        const runDailyAuditMaintenance = async () => {
          // TTL = 1 hour — each sweeper takes < 1s. Extending generously
          // so a slow DB or large table doesn't cause premature expiry.
          const ONE_HOUR = 60 * 60 * 1000
          await withSweepLock('audit_prune', ONE_HOUR, async () => {
            await pruneAuditLog().catch((err) => log.error({ err }, 'audit-log prune failed'))
          })
          await withSweepLock('invite_sweep', ONE_HOUR, async () => {
            await sweepExpiredPortalInvites().catch((err) =>
              log.error({ err }, 'invite sweep failed')
            )
          })
          // EVENTING-V2 outbox retention (WO-20): prune published rows past the
          // window; unpublished rows are never touched.
          await withSweepLock('events_prune', ONE_HOUR, async () => {
            await pruneEventsOutbox().catch((err) =>
              log.error({ err }, 'events outbox prune failed')
            )
          })
          // Log/telemetry retention: ai_usage_log + operational tables
          // (hook deliveries, unsubscribe tokens, in-app notifications),
          // assistant tool-audit + events, and message translations.
          await withSweepLock('logs_retention', ONE_HOUR, async () => {
            await Promise.all([
              cleanupExpiredLogs(),
              cleanupExpiredToolCalls(),
              cleanupExpiredAssistantEvents(),
              cleanupExpiredMessageTranslations(),
            ]).catch((err) => log.error({ err }, 'logs retention cleanup failed'))
          })
        }
        setTimeout(() => {
          void runDailyAuditMaintenance()
        }, 30_000)
        setInterval(
          () => {
            void runDailyAuditMaintenance()
          },
          24 * 60 * 60 * 1000
        )
      }
    )
    .catch((err) => log.error({ err }, 'failed to init audit-log maintenance'))

  // Start periodic summary sweep (refreshes stale/missing post summaries).
  // Runs under a cross-instance lock — AI calls are expensive, so only
  // one replica should generate summaries per tick.
  // Runs once at startup (after a short delay) then every 30 minutes.
  Promise.all([import('./domains/summary/summary.service'), import('@/lib/server/sweep-lock')])
    .then(([{ refreshStaleSummaries }, { withSweepLock }]) => {
      const ONE_HOUR = 60 * 60 * 1000
      setTimeout(() => {
        void withSweepLock('summary_sweep', ONE_HOUR, () =>
          refreshStaleSummaries().catch((err) => log.error({ err }, 'initial summary sweep failed'))
        )
      }, 5_000) // 5s delay to let other startup tasks finish
      setInterval(
        () => {
          void withSweepLock('summary_sweep', ONE_HOUR, () =>
            refreshStaleSummaries().catch((err) => log.error({ err }, 'summary sweep failed'))
          )
        },
        30 * 60 * 1000
      ) // Every 30 minutes
    })
    .catch((err) => log.error({ err }, 'failed to init summary sweep'))

  // Start periodic merge suggestion sweep (detects duplicate posts).
  // Runs under a cross-instance lock — AI calls are expensive and duplicate
  // merge suggestions are user-visible, so only one replica per tick.
  // Runs once at startup (after a short delay) then every 30 minutes.
  Promise.all([
    import('./domains/merge-suggestions/merge-check.service'),
    import('@/lib/server/sweep-lock'),
  ])
    .then(([{ sweepMergeSuggestions }, { withSweepLock }]) => {
      const ONE_HOUR = 60 * 60 * 1000
      setTimeout(() => {
        void withSweepLock('merge_sweep', ONE_HOUR, () =>
          sweepMergeSuggestions().catch((err) =>
            log.error({ err }, 'initial merge suggestion sweep failed')
          )
        )
      }, 15_000) // 15s delay (stagger after summary's 5s)
      setInterval(
        () => {
          void withSweepLock('merge_sweep', ONE_HOUR, () =>
            sweepMergeSuggestions().catch((err) =>
              log.error({ err }, 'merge suggestion sweep failed')
            )
          )
        },
        30 * 60 * 1000
      ) // Every 30 minutes
    })
    .catch((err) => log.error({ err }, 'failed to init merge suggestion sweep'))

  // Changelog publish-notification reconciler: announces any live entry whose
  // notification was missed (a dropped delayed-publish job, or a dispatch that
  // failed after the synchronous publish). Cross-instance lock so only one
  // replica notifies per tick; the per-entry atomic claim guards the rest.
  // Runs shortly after startup, then every 5 minutes.
  Promise.all([import('./domains/changelog/changelog.service'), import('@/lib/server/sweep-lock')])
    .then(([{ reconcileChangelogNotifications }, { withSweepLock }]) => {
      const TEN_MIN = 10 * 60 * 1000
      const runReconcile = () =>
        withSweepLock('changelog_notify', TEN_MIN, async () => {
          await reconcileChangelogNotifications().catch((err) =>
            log.error({ err }, 'changelog notify reconcile failed')
          )
        })
      setTimeout(() => void runReconcile(), 25_000) // 25s delay (stagger after merge's 15s)
      setInterval(() => void runReconcile(), 5 * 60 * 1000) // Every 5 minutes
    })
    .catch((err) => log.error({ err }, 'failed to init changelog notify reconciler'))

  // Status page publish-notification reconciler: same shape as the changelog
  // one above, for status_incidents.notified_at (Status Product Spec §9).
  // Runs shortly after startup, then every 5 minutes.
  Promise.all([import('./domains/status/status.service'), import('@/lib/server/sweep-lock')])
    .then(([{ reconcileStatusNotifications }, { withSweepLock }]) => {
      const TEN_MIN = 10 * 60 * 1000
      const runReconcile = () =>
        withSweepLock('status_notify', TEN_MIN, async () => {
          await reconcileStatusNotifications().catch((err) =>
            log.error({ err }, 'status notify reconcile failed')
          )
        })
      setTimeout(() => void runReconcile(), 28_000) // 28s delay (stagger after changelog's 25s)
      setInterval(() => void runReconcile(), 5 * 60 * 1000) // Every 5 minutes
    })
    .catch((err) => log.error({ err }, 'failed to init status notify reconciler'))

  // Scheduled-maintenance boot sweep: catches window start/complete
  // transitions missed while the process was down (Status Product Spec §9).
  // Runs shortly after startup, then every 5 minutes; each handler is
  // idempotent so overlap with a live delayed job is harmless.
  Promise.all([import('./domains/status/status.maintenance'), import('@/lib/server/sweep-lock')])
    .then(([{ reconcileMaintenanceWindows }, { withSweepLock }]) => {
      const TEN_MIN = 10 * 60 * 1000
      const runReconcile = () =>
        withSweepLock('status_maintenance_sweep', TEN_MIN, async () => {
          await reconcileMaintenanceWindows().catch((err) =>
            log.error({ err }, 'status maintenance window reconcile failed')
          )
        })
      setTimeout(() => void runReconcile(), 31_000) // 31s delay (stagger after status notify's 28s)
      setInterval(() => void runReconcile(), 5 * 60 * 1000) // Every 5 minutes
    })
    .catch((err) => log.error({ err }, 'failed to init status maintenance sweep'))
}
