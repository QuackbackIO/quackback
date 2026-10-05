/**
 * Environment variables an operator may still have set from an earlier
 * deployment shape. They are ignored; naming them once at startup lets the
 * operator remove them (and the service they pointed at).
 */

interface InfoLogger {
  info: (obj: Record<string, unknown>, msg: string) => void
}

/** Logs one info line when `REDIS_URL` is set. Returns whether it logged. */
export function logUnusedRedisUrl(
  log: InfoLogger,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!env.REDIS_URL?.trim()) return false
  log.info(
    { variable: 'REDIS_URL' },
    'REDIS_URL is set but is not used. Queues, rate limits, caching and realtime run on ' +
      'Postgres, so the variable can be removed along with the Redis service.'
  )
  return true
}
