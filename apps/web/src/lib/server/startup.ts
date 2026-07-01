/**
 * Startup banner -- logs build and runtime info once on first request.
 * Build-time constants are injected via Vite `define`; runtime info is read at call time.
 */
import { logger } from '@/lib/server/logger'

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
        const closes = await Promise.allSettled([
          import('./events/process').then(({ closeQueue }) => closeQueue()),
          import('./events/segment-scheduler').then(({ closeSegmentScheduler }) =>
            closeSegmentScheduler()
          ),
          import('./domains/feedback/queues/feedback-ai-queue').then(({ closeFeedbackAiQueue }) =>
            closeFeedbackAiQueue()
          ),
          import('./domains/feedback/queues/feedback-ingest-queue').then(
            ({ closeFeedbackIngestQueue }) => closeFeedbackIngestQueue()
          ),
        ])
        for (const r of closes) {
          if (r.status === 'rejected') log.error({ err: r.reason }, 'queue close failed')
        }

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
  // During Nitro's initial build evaluation, SECRET_KEY isn't available yet.
  // Return without setting _logged so the runtime call can still execute.
  if (!process.env.SECRET_KEY && process.env.NODE_ENV !== 'test') return

  if (_logged) return
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
      built: __BUILD_TIME__,
    },
    'server started'
  )

  // Surface half-configured AI loudly instead of failing silently (see #180).
  import('@/lib/server/domains/ai/config')
    .then(({ validateAiConfig }) => validateAiConfig())
    .catch((err) => log.error({ err }, 'ai config validation failed'))

  // Wire SIGTERM/SIGINT once — the rest of this function spawns
  // long-lived workers + sweepers, so register the drain handler before
  // any of them start so a fast Ctrl-C in dev still gets a clean exit.
  wireGracefulShutdown()

  // Restore any dynamic segment evaluation schedules that were persisted in the
  // DB but may be absent from Redis (e.g. after a Redis wipe in dev). BullMQ
  // repeatable jobs survive normal app restarts, but this is a safety net.
  import('@/lib/server/events/segment-scheduler')
    .then(({ restoreAllEvaluationSchedules }) => restoreAllEvaluationSchedules())
    .catch((err) => log.error({ err }, 'failed to restore segment schedules'))

  // Initialize feedback AI worker eagerly so it processes jobs from any source
  import('./domains/feedback/queues/feedback-ai-queue')
    .then(({ initFeedbackAiWorker }) => initFeedbackAiWorker())
    .catch((err) => log.error({ err }, 'failed to init feedback ai worker'))

  // Initialize analytics worker (hourly stats refresh)
  import('./domains/analytics/analytics-queue')
    .then(({ initAnalyticsWorker }) => initAnalyticsWorker())
    .catch((err) => log.error({ err }, 'failed to init analytics worker'))

  // Initialize anonymous-principal sweep worker (daily; bounds anon-row bloat)
  import('./domains/principals/anon-sweep-queue')
    .then(({ initAnonSweepWorker }) => initAnonSweepWorker())
    .catch((err) => log.error({ err }, 'failed to init anon-sweep worker'))

  // Periodic feedback maintenance (stuck-item recovery every 15min, suggestion expiry daily).
  // Runs under a cross-instance lock so only one replica executes per tick.
  Promise.all([
    import('./domains/feedback/pipeline/stuck-recovery.service'),
    import('./domains/feedback/pipeline/suggestion.service'),
    import('@/lib/server/sweep-lock'),
  ])
    .then(([{ recoverStuckItems }, { expireStaleSuggestions }, { withSweepLock }]) => {
      const ONE_HOUR = 60 * 60 * 1000
      setTimeout(() => {
        void withSweepLock('stuck_recovery', ONE_HOUR, () =>
          recoverStuckItems().catch((err: unknown) =>
            log.error({ err }, 'initial stuck-item recovery failed')
          )
        )
      }, 20_000) // 20s delay
      setInterval(
        () => {
          void withSweepLock('stuck_recovery', ONE_HOUR, () =>
            recoverStuckItems().catch((err: unknown) =>
              log.error({ err }, 'stuck-item recovery failed')
            )
          )
        },
        15 * 60 * 1000
      ) // Every 15 minutes
      setInterval(
        () => {
          void withSweepLock('suggestion_expiry', ONE_HOUR, async () => {
            await expireStaleSuggestions().catch((err: unknown) =>
              log.error({ err }, 'suggestion expiry failed')
            )
          })
        },
        24 * 60 * 60 * 1000
      ) // Daily
    })
    .catch((err) => log.error({ err }, 'failed to init feedback maintenance'))

  // Audit-log retention sweep + expired portal/team invite sweep.
  // Daily maintenance runs under a cross-instance lock so only one
  // replica executes per tick in multi-instance deployments.
  Promise.all([
    import('@/lib/server/audit/log'),
    import('@/lib/server/audit/invite-sweep'),
    import('@/lib/server/sweep-lock'),
  ])
    .then(([{ pruneAuditLog }, { sweepExpiredPortalInvites }, { withSweepLock }]) => {
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
    })
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

  // Ensure quackback feedback source exists (idempotent, creates on first startup)
  import('./domains/feedback/sources/quackback.source')
    .then(({ ensureQuackbackFeedbackSource }) => ensureQuackbackFeedbackSource())
    .catch((err) => log.error({ err }, 'failed to ensure quackback feedback source'))

  // One-time in-place data backfills (idempotent, advisory-locked). Runs the
  // custom-oidc → identity_provider migration that needs SECRET_KEY to decrypt
  // its credential and so can't live in the SQL migration bundle.
  import('@/lib/server/auth/backfill-custom-oidc-provider')
    .then(({ runStartupBackfills }) => runStartupBackfills())
    .catch((err) => log.error({ err }, 'failed to run startup backfills'))

  // Quackback config file watcher — reconciles managed fields from
  // /etc/quackback/config.yaml on every change. No-op when the file
  // is absent (self-host default).
  import('@/lib/server/config-file')
    .then(({ startQuackbackConfigWatcher }) => startQuackbackConfigWatcher())
    .catch((err) => log.error({ err }, 'failed to start config-file watcher'))
}
