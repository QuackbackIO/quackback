/**
 * CLI: delete the given Redis cache keys so a running dev server picks up
 * raw-SQL mutations immediately. Used by the e2e helpers instead of exec-ing
 * redis-cli inside the Redis container, so cache busting also works in CI
 * where no docker access is available.
 *
 * Usage: bun bust-caches.ts <key> [key...]
 */
import Redis from 'ioredis'

const keys = process.argv.slice(2)
if (keys.length === 0) {
  console.error('Usage: bun bust-caches.ts <key> [key...]')
  process.exit(1)
}

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  console.error('REDIS_URL environment variable is required')
  process.exit(1)
}

const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 5000 })

try {
  await redis.connect()
  const deleted = await redis.del(...keys)
  console.log(JSON.stringify({ deleted }))
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  redis.disconnect()
}
