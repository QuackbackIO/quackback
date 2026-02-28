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

  // Ensure quackback feedback source exists (idempotent, creates on first startup)
  import('./domains/feedback/sources/quackback.source')
    .then(({ ensureQuackbackFeedbackSource }) => ensureQuackbackFeedbackSource())
    .then(() =>
      // Reset the hook handler's cache so it picks up the newly-created source
      import('./events/handlers/feedback-pipeline').then(({ resetQuackbackSourceCache }) =>
        resetQuackbackSourceCache()
      )
    )
    .catch((err) => console.error('[Startup] Failed to ensure quackback feedback source:', err))
}
