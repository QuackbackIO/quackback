/**
 * Job and state adapters for BullMQ + Redis.
 *
 * This file provides job queue and state management using BullMQ and Redis.
 */

import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { getConnection, createRedisClient } from './connection'
import type {
  ImportJobData,
  ImportJobResult,
  ImportJobStatus,
  EventJobData,
  EventJobResult,
} from './types'

// ============================================================================
// Types
// ============================================================================

export interface JobAdapter {
  addImportJob(data: ImportJobData): Promise<string>
  getImportJobStatus(jobId: string): Promise<ImportJobStatus | null>
  addEventJob(data: EventJobData): Promise<string>
  close?(): Promise<void>
}

export interface StateAdapter {
  canExecute(integrationId: string): Promise<boolean>
  recordSuccess(integrationId: string): Promise<void>
  recordFailure(integrationId: string): Promise<void>
  isProcessed(eventId: string, integrationId: string): Promise<boolean>
  markProcessed(eventId: string, integrationId: string, externalId?: string): Promise<void>
  getProcessedResult(eventId: string, integrationId: string): Promise<string | null>
  cacheGet(key: string): Promise<string | null>
  cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void>
  cacheDel(key: string): Promise<void>
}

export interface CircuitState {
  state: 'closed' | 'open' | 'half-open'
  failures: number
  lastFailure: number
  lastSuccess: number
}

export const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeout: 60_000,
  stateTtl: 3600,
} as const

export const IDEMPOTENCY_CONFIG = {
  ttl: 7 * 24 * 60 * 60,
} as const

// ============================================================================
// Queue Names
// ============================================================================

export const QueueNames = {
  IMPORT: '{import}',
  EVENTS: '{events}',
} as const

// ============================================================================
// Job Adapter (BullMQ)
// ============================================================================

let _importQueue: Queue<ImportJobData, ImportJobResult> | null = null
let _eventsQueue: Queue<EventJobData, EventJobResult> | null = null

function getImportQueue(): Queue<ImportJobData, ImportJobResult> {
  if (!_importQueue) {
    _importQueue = new Queue<ImportJobData, ImportJobResult>(QueueNames.IMPORT, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 100 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    })
  }
  return _importQueue
}

function getEventsQueue(): Queue<EventJobData, EventJobResult> {
  if (!_eventsQueue) {
    _eventsQueue = new Queue<EventJobData, EventJobResult>(QueueNames.EVENTS, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    })
  }
  return _eventsQueue
}

export async function addImportJob(data: ImportJobData): Promise<string> {
  const queue = getImportQueue()
  const job = await queue.add('import-posts', data, {
    jobId: `import-${Date.now()}`,
  })
  return job.id!
}

export async function getImportJobStatus(jobId: string): Promise<ImportJobStatus | null> {
  const queue = getImportQueue()
  const job = await queue.getJob(jobId)

  if (!job) {
    return null
  }

  const state = await job.getState()
  const progress = job.progress as { processed: number; total: number } | undefined

  return {
    jobId: job.id!,
    status: state as 'waiting' | 'active' | 'completed' | 'failed',
    progress,
    result: job.returnvalue,
    error: job.failedReason,
  }
}

export async function addEventJob(data: EventJobData): Promise<string> {
  const queue = getEventsQueue()
  const job = await queue.add(`event-${data.type}`, data, {
    jobId: `event-${data.id}`,
  })
  return job.id!
}

// ============================================================================
// State Adapter (Redis)
// ============================================================================

let _redis: Redis | null = null

function getRedis(): Redis {
  if (!_redis) {
    _redis = createRedisClient()
  }
  return _redis
}

// Circuit breaker

export async function canExecute(integrationId: string): Promise<boolean> {
  const state = await getCircuitState(integrationId)

  if (state.state === 'closed') return true

  if (state.state === 'open') {
    if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
      await setCircuitState(integrationId, { ...state, state: 'half-open' })
      return true
    }
    return false
  }

  return true // half-open
}

export async function recordSuccess(integrationId: string): Promise<void> {
  await setCircuitState(integrationId, {
    failures: 0,
    lastFailure: 0,
    lastSuccess: Date.now(),
    state: 'closed',
  })
}

export async function recordFailure(integrationId: string): Promise<void> {
  const state = await getCircuitState(integrationId)
  const newFailures = state.failures + 1

  await setCircuitState(integrationId, {
    ...state,
    failures: newFailures,
    lastFailure: Date.now(),
    state: newFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold ? 'open' : state.state,
  })
}

async function getCircuitState(integrationId: string): Promise<CircuitState> {
  const redis = getRedis()
  const key = `circuit:${integrationId}`
  const data = await redis.get(key)

  if (!data) {
    return { failures: 0, lastFailure: 0, lastSuccess: 0, state: 'closed' }
  }

  return JSON.parse(data)
}

async function setCircuitState(integrationId: string, state: CircuitState): Promise<void> {
  const redis = getRedis()
  const key = `circuit:${integrationId}`
  await redis.setex(key, CIRCUIT_BREAKER_CONFIG.stateTtl, JSON.stringify(state))
}

// Idempotency

export async function isProcessed(eventId: string, integrationId: string): Promise<boolean> {
  const redis = getRedis()
  const key = `idem:${eventId}:${integrationId}`
  return (await redis.exists(key)) === 1
}

export async function markProcessed(
  eventId: string,
  integrationId: string,
  externalId?: string
): Promise<void> {
  const redis = getRedis()
  const key = `idem:${eventId}:${integrationId}`
  await redis.setex(key, IDEMPOTENCY_CONFIG.ttl, externalId || 'processed')
}

export async function getProcessedResult(
  eventId: string,
  integrationId: string
): Promise<string | null> {
  const redis = getRedis()
  const key = `idem:${eventId}:${integrationId}`
  const result = await redis.get(key)
  return result === 'processed' ? null : result
}

// Generic cache

export async function cacheGet(key: string): Promise<string | null> {
  const redis = getRedis()
  return redis.get(key)
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const redis = getRedis()
  if (ttlSeconds) {
    await redis.setex(key, ttlSeconds, value)
  } else {
    await redis.set(key, value)
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = getRedis()
  await redis.del(key)
}

// ============================================================================
// Adapter Wrappers (for backwards compatibility)
// ============================================================================

let _jobAdapter: JobAdapter | null = null
let _stateAdapter: StateAdapter | null = null

export function getJobAdapter(): JobAdapter {
  if (!_jobAdapter) {
    _jobAdapter = {
      addImportJob,
      getImportJobStatus,
      addEventJob,
      close: closeAdapters,
    }
  }
  return _jobAdapter
}

export function getStateAdapter(): StateAdapter {
  if (!_stateAdapter) {
    _stateAdapter = {
      canExecute,
      recordSuccess,
      recordFailure,
      isProcessed,
      markProcessed,
      getProcessedResult,
      cacheGet,
      cacheSet,
      cacheDel,
    }
  }
  return _stateAdapter
}

// ============================================================================
// Cleanup
// ============================================================================

export async function closeAdapters(): Promise<void> {
  const closePromises: Promise<void>[] = []

  if (_importQueue) {
    closePromises.push(_importQueue.close())
    _importQueue = null
  }
  if (_eventsQueue) {
    closePromises.push(_eventsQueue.close())
    _eventsQueue = null
  }
  if (_redis) {
    closePromises.push(_redis.quit().then(() => {}))
    _redis = null
  }

  await Promise.all(closePromises)
}
