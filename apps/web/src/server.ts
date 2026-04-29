import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { logStartupBanner } from '@/lib/server/startup'

// Cold-start optimization: eagerly warm DB + Redis connections AND preload
// the modules that bootstrap.ts dynamically imports on first SSR. The
// underlying TCP+TLS handshakes happen in parallel with Bun's module load
// + Knative's pod-readiness propagation, so by the time the first request
// reaches the handler, the import cache is warm and the connection pools
// are established. All probes are fire-and-forget; the actual query path
// retries from cold if the warmup fails.
if (process.env.SECRET_KEY) {
  Promise.all([
    import('@/lib/server/db').then(({ db, sql }) => db.execute(sql`SELECT 1`)),
    import('@/lib/server/redis').then(({ cacheGet }) => cacheGet('__warmup__')),
    import('@/lib/server/auth/index'),
    import('@/lib/server/domains/settings/settings.service'),
    import('@/lib/server/config'),
    import('@tanstack/react-start/server'),
  ]).catch(() => {
    // Pool initialization happens inside getDatabase()/getRedis(); if the
    // first probe fails the next real query will retry from cold.
  })
}

logStartupBanner()

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
