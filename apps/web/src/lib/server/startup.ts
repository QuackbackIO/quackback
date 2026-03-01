/**
 * Startup banner -- logs build and runtime info once on first request.
 * Build-time constants are injected via Vite `define`; runtime info is read at call time.
 */

let _logged = false

export function logStartupBanner(): void {
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

  // Restore feedback pipeline schedules (lazy import to avoid eager queue init)
  import('./domains/feedback/queues/feedback-maintenance-queue')
    .then(({ restoreAllFeedbackSchedules }) => restoreAllFeedbackSchedules())
    .catch((err) => console.error('[Startup] Failed to restore feedback schedules:', err))

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
}
