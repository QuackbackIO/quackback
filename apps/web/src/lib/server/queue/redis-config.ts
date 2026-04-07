import { config } from '@/lib/server/config'

/**
 * Shared Redis connection options for BullMQ queues and workers.
 * Returns a new object each call — BullMQ requires distinct connection objects per queue/worker.
 */
export function getRedisConnectionOpts() {
  return {
    url: config.redisUrl,
    maxRetriesPerRequest: null as null,
    connectTimeout: 5_000,
  }
}

/** Default timeout (ms) for Redis connection readiness checks. */
export const REDIS_READY_TIMEOUT_MS = 5_000
