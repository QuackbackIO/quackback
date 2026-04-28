import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { logStartupBanner } from '@/lib/server/startup'

// Fire DB + Redis connection establishment as soon as this module loads, so
// the cold-start first SSR render finds the pools already warm. Each is a
// fire-and-forget query that establishes the underlying TCP+TLS handshake.
// On failure we swallow — the connection retry is handled by the actual
// query path; this is purely an opportunistic warmup.
if (process.env.SECRET_KEY) {
  Promise.all([
    import('@/lib/server/db').then(({ db, sql }) => db.execute(sql`SELECT 1`)),
    import('@/lib/server/redis').then(({ cacheGet }) => cacheGet('__warmup__')),
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
