/**
 * Startup banner -- logs build and runtime info once on first request.
 * Build-time constants are injected via Vite `define`; runtime info is read at call time.
 */

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
    console.log(`[Shutdown] ${signal} received — draining queues`)

    // Hard timeout: if any close hangs, force-exit. The deadline starts
    // ticking the moment we receive the signal, not after closes resolve.
    const forceExit = setTimeout(() => {
      console.error('[Shutdown] 30s timeout exceeded — force-exiting')
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
          if (r.status === 'rejected') console.error('[Shutdown] close error:', r.reason)
        }

        // After all queues + workers have closed, quit the shared
        // IORedis client so we don't leave a half-open socket behind.
        await import('./queue/redis-config').then(({ closeQueueRedis }) => closeQueueRedis())

        clearTimeout(forceExit)
        console.log('[Shutdown] complete')
        process.exit(0)
      } catch (err) {
        console.error('[Shutdown] fatal:', err)
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
  const env = process.env.NODE_ENV ?? 'development'
  const port = process.env.PORT ?? '3000'
  const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`

  const lines = [
    '',
    '========================================',
    `  Quackback v${__APP_VERSION__} (${__GIT_COMMIT__})`,
    '========================================',
    `  Environment: ${env}`,
    `  Runtime:     ${runtime}`,
    `  Base URL:    ${baseUrl}`,
    `  Built:       ${__BUILD_TIME__}`,
    '========================================',
    '',
  ]

  console.log(lines.join('\n'))

  // Wire SIGTERM/SIGINT once — the rest of this function spawns
  // long-lived workers + sweepers, so register the drain handler before
  // any of them start so a fast Ctrl-C in dev still gets a clean exit.
  wireGracefulShutdown()

  // Restore any dynamic segment evaluation schedules that were persisted in the
  // DB but may be absent from Redis (e.g. after a Redis wipe in dev). BullMQ
  // repeatable jobs survive normal app restarts, but this is a safety net.
  import('@/lib/server/events/segment-scheduler')
    .then(({ restoreAllEvaluationSchedules }) => restoreAllEvaluationSchedules())
    .catch((err) => console.error('[Startup] Failed to restore segment schedules:', err))

  // Initialize feedback AI worker eagerly so it processes jobs from any source
  import('./domains/feedback/queues/feedback-ai-queue')
    .then(({ initFeedbackAiWorker }) => initFeedbackAiWorker())
    .catch((err) => console.error('[Startup] Failed to init feedback AI worker:', err))

  // Initialize analytics worker (hourly stats refresh)
  import('./domains/analytics/analytics-queue')
    .then(({ initAnalyticsWorker }) => initAnalyticsWorker())
    .catch((err) => console.error('[Startup] Failed to init analytics worker:', err))

  // Periodic feedback maintenance (stuck-item recovery every 15min, suggestion expiry daily)
  Promise.all([
    import('./domains/feedback/pipeline/stuck-recovery.service'),
    import('./domains/feedback/pipeline/suggestion.service'),
  ])
    .then(([{ recoverStuckItems }, { expireStaleSuggestions }]) => {
      setTimeout(() => {
        recoverStuckItems().catch((err: unknown) =>
          console.error('[Startup] Initial stuck-item recovery failed:', err)
        )
      }, 20_000) // 20s delay
      setInterval(
        () => {
          recoverStuckItems().catch((err: unknown) =>
            console.error('[Startup] Stuck-item recovery failed:', err)
          )
        },
        15 * 60 * 1000
      ) // Every 15 minutes
      setInterval(
        () => {
          expireStaleSuggestions().catch((err: unknown) =>
            console.error('[Startup] Suggestion expiry failed:', err)
          )
        },
        24 * 60 * 60 * 1000
      ) // Daily
    })
    .catch((err) => console.error('[Startup] Failed to init feedback maintenance:', err))

  // Audit-log retention sweep. Once a day deletes rows older than
  // the configured retention window (default 365d, SOC2-aligned).
  // First sweep runs 30s after boot so it doesn't compete with
  // migrations + worker init on the startup hot path.
  //
  // Also sweeps expired portal invitations: finds pending invites past
  // their expiresAt, emits portal.invite.expired per invite, and bulk-
  // updates status='expired'. Runs in the same daily timer so both
  // maintenance tasks share a single scheduler.
  Promise.all([import('@/lib/server/audit/log'), import('@/lib/server/audit/invite-sweep')])
    .then(([{ pruneAuditLog }, { sweepExpiredPortalInvites }]) => {
      const runDailyAuditMaintenance = async () => {
        await pruneAuditLog().catch((err) =>
          console.error('[Startup] Audit-log prune failed:', err)
        )
        await sweepExpiredPortalInvites().catch((err) =>
          console.error('[Startup] Invite sweep failed:', err)
        )
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
    .catch((err) => console.error('[Startup] Failed to init audit-log maintenance:', err))

  // Start periodic summary sweep (refreshes stale/missing post summaries)
  // Runs once at startup (after a short delay) then every 30 minutes
  import('./domains/summary/summary.service')
    .then(({ refreshStaleSummaries }) => {
      setTimeout(() => {
        refreshStaleSummaries().catch((err) =>
          console.error('[Startup] Initial summary sweep failed:', err)
        )
      }, 5_000) // 5s delay to let other startup tasks finish
      setInterval(
        () => {
          refreshStaleSummaries().catch((err) =>
            console.error('[Startup] Summary sweep failed:', err)
          )
        },
        30 * 60 * 1000
      ) // Every 30 minutes
    })
    .catch((err) => console.error('[Startup] Failed to init summary sweep:', err))

  // Start periodic merge suggestion sweep (detects duplicate posts)
  // Runs once at startup (after a short delay) then every 30 minutes
  import('./domains/merge-suggestions/merge-check.service')
    .then(({ sweepMergeSuggestions }) => {
      setTimeout(() => {
        sweepMergeSuggestions().catch((err) =>
          console.error('[Startup] Initial merge suggestion sweep failed:', err)
        )
      }, 15_000) // 15s delay (stagger after summary's 5s)
      setInterval(
        () => {
          sweepMergeSuggestions().catch((err) =>
            console.error('[Startup] Merge suggestion sweep failed:', err)
          )
        },
        30 * 60 * 1000
      ) // Every 30 minutes
    })
    .catch((err) => console.error('[Startup] Failed to init merge suggestion sweep:', err))

  // Ensure quackback feedback source exists (idempotent, creates on first startup)
  import('./domains/feedback/sources/quackback.source')
    .then(({ ensureQuackbackFeedbackSource }) => ensureQuackbackFeedbackSource())
    .catch((err) => console.error('[Startup] Failed to ensure quackback feedback source:', err))

  // Quackback config file watcher — reconciles managed fields from
  // /etc/quackback/config.yaml on every change. No-op when the file
  // is absent (self-host default).
  import('@/lib/server/config-file')
    .then(({ startQuackbackConfigWatcher }) => startQuackbackConfigWatcher())
    .catch((err) => console.error('[Startup] Failed to start config-file watcher:', err))
}
