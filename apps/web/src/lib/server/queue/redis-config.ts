import IORedis from 'ioredis'
import { config } from '@/lib/server/config'

/**
 * Single shared IORedis connection for every BullMQ Queue + Worker in the
 * process. BullMQ duplicates this client internally for blocking commands,
 * but the base TCP socket is shared — so we get one connection per process
 * instead of one per queue/worker (we run 5+ queues, the difference matters
 * on small Redis plans).
 *
 * `maxRetriesPerRequest: null` is required by BullMQ workers per its docs;
 * queues are happy with the same setting.
 */
let _shared: IORedis | null = null

export function getQueueRedis(): any {
  if (!_shared) {
    _shared = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: 5_000,
    })
  }
  return _shared
}

/**
 * Convenience for `new Queue(name, getQueueConnection())` /
 * `new Worker(name, fn, getQueueConnection())`. Returns the shared
 * IORedis instance wrapped in BullMQ's connection option shape.
 */
export function getQueueConnection(): { connection: any } {
  return { connection: getQueueRedis() }
}

/**
 * Close the shared Redis connection. Call from graceful shutdown after
 * all queues + workers have closed.
 */
export async function closeQueueRedis(): Promise<void> {
  if (!_shared) return
  const client = _shared
  _shared = null
  await client.quit().catch(() => {
    // .quit() can race with in-flight commands; force-disconnect on error.
    client.disconnect()
  })
}

/** Default timeout (ms) for Redis connection readiness checks. */
export const REDIS_READY_TIMEOUT_MS = 5_000
