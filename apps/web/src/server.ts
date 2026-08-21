import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { assertBootConfigurationOrExit } from '@/lib/server/boot-config'
import { logStartupBanner } from '@/lib/server/startup'

// FIRST, and above the warmup below on purpose. A misconfigured process must
// refuse before it opens a single socket, and the warmup opens several. This
// used to live inside logStartupBanner() — after the warmup — where it was
// correct only because a synchronous throw beat a microtask by 115 ms. It now
// exits non-zero instead of throwing: a throw at module scope is cached by ESM,
// so every route 500s forever while the process stays up and keeps dialling.
assertBootConfigurationOrExit()

// Cold-start optimization: eagerly warm the database connections AND preload
// the modules that bootstrap.ts dynamically imports on first SSR. The
// underlying TCP+TLS handshakes happen in parallel with Bun's module load
// + Knative's pod-readiness propagation, so by the time the first request
// reaches the handler, the import cache is warm and the connection pools
// are established. All probes are fire-and-forget; the actual query path
// retries from cold if the warmup fails.
if (process.env.QUACKBACK_BUILD !== '1') {
  Promise.all([
    import('@/lib/server/db').then(({ db, sql }) => db.execute(sql`SELECT 1`)),
    import('@/lib/server/auth/index'),
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/config'),
    import('@tanstack/react-start/server'),
    import('@/lib/server/email/email-log.sink').then((m) => m.ensureEmailLogSink()),
  ]).catch(() => {
    // Pool initialization happens inside getDatabase(); if the
    // first probe fails the next real query will retry from cold.
  })
}

logStartupBanner()

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
