/**
 * CLI: clear the magic-link sign-in rate-limit buckets in Redis.
 *
 * Repeated e2e runs from one machine hit the per-IP magic-link limiter
 * (keys `signin:magiclink:*`), which then 429s the sign-in POST and fails
 * every spec that authenticates a portal user. Run this before specs that
 * request magic links.
 *
 * Usage: bun clear-signin-rate-limit.ts
 */
import Redis from 'ioredis'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  console.error('REDIS_URL environment variable is required')
  process.exit(1)
}

const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 5000 })

try {
  await redis.connect()
  let cursor = '0'
  let deleted = 0
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'signin:magiclink:*', 'COUNT', 500)
    cursor = next
    if (keys.length > 0) deleted += await redis.del(...keys)
  } while (cursor !== '0')
  console.log(JSON.stringify({ deleted }))
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  redis.disconnect()
}
