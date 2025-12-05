import { Redis } from 'ioredis'
import type { ConnectionOptions } from 'bullmq'

/**
 * Parse Redis URL into connection options for BullMQ
 */
function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  }
}

/**
 * Get Redis connection options from environment
 */
export function getConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is not set')
  }
  return parseRedisUrl(redisUrl)
}

/**
 * Shared connection options for BullMQ queues and workers
 * Uses lazy initialization to avoid connection issues during module load
 */
let _connection: ConnectionOptions | null = null

export function getConnection(): ConnectionOptions {
  if (!_connection) {
    _connection = getConnectionOptions()
  }
  return _connection
}

/**
 * Create a new Redis client for direct Redis operations
 * (e.g., for health checks or custom operations)
 */
export function createRedisClient(): Redis {
  const options = getConnectionOptions()
  return new Redis({
    host: options.host,
    port: options.port,
    password: options.password,
    username: options.username,
    maxRetriesPerRequest: null, // Required for BullMQ compatibility
  })
}
