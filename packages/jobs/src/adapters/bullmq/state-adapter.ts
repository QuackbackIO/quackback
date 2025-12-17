/**
 * Redis state adapter for OSS/self-hosted deployments.
 *
 * Uses Redis for circuit breaker state, idempotency tracking, and caching.
 * This adapter is used when running in Node.js/Bun environment.
 */

import type { Redis } from 'ioredis'
import { createRedisClient } from '../../connection'
import type { StateAdapter, CircuitState } from '../types'
import { CIRCUIT_BREAKER_CONFIG, IDEMPOTENCY_CONFIG } from '../types'

/**
 * Redis implementation of the StateAdapter interface.
 */
export class RedisStateAdapter implements StateAdapter {
  private _redis: Redis | null = null

  /**
   * Get or create the Redis client instance.
   */
  private getRedis(): Redis {
    if (!this._redis) {
      this._redis = createRedisClient()
    }
    return this._redis
  }

  // Circuit breaker operations

  async canExecute(integrationId: string): Promise<boolean> {
    const state = await this.getCircuitState(integrationId)

    if (state.state === 'closed') {
      return true
    }

    if (state.state === 'open') {
      // Check if reset timeout has passed
      if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
        await this.setCircuitState(integrationId, { ...state, state: 'half-open' })
        return true // Allow one request through
      }
      return false
    }

    // half-open: allow request
    return true
  }

  async recordSuccess(integrationId: string): Promise<void> {
    await this.setCircuitState(integrationId, {
      failures: 0,
      lastFailure: 0,
      lastSuccess: Date.now(),
      state: 'closed',
    })
  }

  async recordFailure(integrationId: string): Promise<void> {
    const state = await this.getCircuitState(integrationId)
    const newFailures = state.failures + 1

    await this.setCircuitState(integrationId, {
      ...state,
      failures: newFailures,
      lastFailure: Date.now(),
      state: newFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold ? 'open' : state.state,
    })
  }

  private async getCircuitState(integrationId: string): Promise<CircuitState> {
    const redis = this.getRedis()
    const key = `circuit:${integrationId}`
    const data = await redis.get(key)

    if (!data) {
      return { failures: 0, lastFailure: 0, lastSuccess: 0, state: 'closed' }
    }

    return JSON.parse(data)
  }

  private async setCircuitState(integrationId: string, state: CircuitState): Promise<void> {
    const redis = this.getRedis()
    const key = `circuit:${integrationId}`
    await redis.setex(key, CIRCUIT_BREAKER_CONFIG.stateTtl, JSON.stringify(state))
  }

  // Idempotency operations

  async isProcessed(eventId: string, integrationId: string): Promise<boolean> {
    const redis = this.getRedis()
    const key = `idem:${eventId}:${integrationId}`
    const exists = await redis.exists(key)
    return exists === 1
  }

  async markProcessed(eventId: string, integrationId: string, externalId?: string): Promise<void> {
    const redis = this.getRedis()
    const key = `idem:${eventId}:${integrationId}`
    await redis.setex(key, IDEMPOTENCY_CONFIG.ttl, externalId || 'processed')
  }

  async getProcessedResult(eventId: string, integrationId: string): Promise<string | null> {
    const redis = this.getRedis()
    const key = `idem:${eventId}:${integrationId}`
    const result = await redis.get(key)
    return result === 'processed' ? null : result
  }

  // Generic caching operations

  async get(key: string): Promise<string | null> {
    const redis = this.getRedis()
    return redis.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const redis = this.getRedis()
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, value)
    } else {
      await redis.set(key, value)
    }
  }

  async del(key: string): Promise<void> {
    const redis = this.getRedis()
    await redis.del(key)
  }

  /**
   * Close the Redis connection (for graceful shutdown).
   */
  async close(): Promise<void> {
    if (this._redis) {
      await this._redis.quit()
      this._redis = null
    }
  }
}
