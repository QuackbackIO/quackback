import { Queue } from 'bullmq'
import { getConnection } from './connection'
import type {
  ImportJobData,
  ImportJobResult,
  IntegrationJobData,
  IntegrationJobResult,
  UserNotificationJobData,
  UserNotificationJobResult,
} from './types'

/**
 * Queue names using curly brace notation for DragonflyDB cluster compatibility
 * The {prefix} ensures all keys for this queue are on the same shard
 */
export const QueueNames = {
  IMPORT: '{import}',
  INTEGRATIONS: '{integrations}',
  USER_NOTIFICATIONS: '{user-notifications}',
} as const

/**
 * Lazy-initialized queue instances
 * We use lazy initialization to avoid connection issues during module import
 */
let _importQueue: Queue<ImportJobData, ImportJobResult> | null = null

/**
 * Get the import queue instance
 * Creates the queue on first access
 */
export function getImportQueue(): Queue<ImportJobData, ImportJobResult> {
  if (!_importQueue) {
    _importQueue = new Queue<ImportJobData, ImportJobResult>(QueueNames.IMPORT, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 100, // Keep last 100 completed jobs
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    })
  }
  return _importQueue
}

/**
 * Add an import job to the queue
 */
export async function addImportJob(data: ImportJobData): Promise<string> {
  const queue = getImportQueue()
  const job = await queue.add('import-posts', data, {
    jobId: `import-${data.organizationId}-${Date.now()}`,
  })
  return job.id!
}

/**
 * Get job status by ID
 */
export async function getImportJobStatus(jobId: string) {
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
    progress: progress,
    result: job.returnvalue,
    error: job.failedReason,
  }
}

/**
 * Close all queue connections (for graceful shutdown)
 */
export async function closeQueues(): Promise<void> {
  if (_importQueue) {
    await _importQueue.close()
    _importQueue = null
  }
  if (_integrationsQueue) {
    await _integrationsQueue.close()
    _integrationsQueue = null
  }
  if (_userNotificationsQueue) {
    await _userNotificationsQueue.close()
    _userNotificationsQueue = null
  }
}

// ============================================================================
// Integrations Queue
// ============================================================================

let _integrationsQueue: Queue<IntegrationJobData, IntegrationJobResult> | null = null

/**
 * Get the integrations queue instance
 * Creates the queue on first access
 */
export function getIntegrationsQueue(): Queue<IntegrationJobData, IntegrationJobResult> {
  if (!_integrationsQueue) {
    _integrationsQueue = new Queue<IntegrationJobData, IntegrationJobResult>(
      QueueNames.INTEGRATIONS,
      {
        connection: getConnection(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 24 * 3600, // Keep completed jobs for 24 hours
            count: 1000, // Keep last 1000 completed jobs
          },
          removeOnFail: {
            age: 7 * 24 * 3600, // Keep failed jobs for 7 days
          },
        },
      }
    )
  }
  return _integrationsQueue
}

/**
 * Add an integration job to the queue
 */
export async function addIntegrationJob(
  data: IntegrationJobData,
  options?: { jobId?: string }
): Promise<string> {
  const queue = getIntegrationsQueue()
  // Use dashes instead of colons - BullMQ doesn't allow colons in job IDs
  const jobId = options?.jobId ?? `${data.event.id}-${data.integrationId}`
  const job = await queue.add(`${data.integrationType}-${data.event.type}`, data, {
    jobId,
  })
  return job.id!
}

// ============================================================================
// User Notifications Queue
// ============================================================================

let _userNotificationsQueue: Queue<UserNotificationJobData, UserNotificationJobResult> | null = null

/**
 * Get the user notifications queue instance
 * Creates the queue on first access
 */
export function getUserNotificationsQueue(): Queue<
  UserNotificationJobData,
  UserNotificationJobResult
> {
  if (!_userNotificationsQueue) {
    _userNotificationsQueue = new Queue<UserNotificationJobData, UserNotificationJobResult>(
      QueueNames.USER_NOTIFICATIONS,
      {
        connection: getConnection(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 24 * 3600, // Keep completed jobs for 24 hours
            count: 1000, // Keep last 1000 completed jobs
          },
          removeOnFail: {
            age: 7 * 24 * 3600, // Keep failed jobs for 7 days
          },
        },
      }
    )
  }
  return _userNotificationsQueue
}

/**
 * Add a user notification job to the queue
 */
export async function addUserNotificationJob(data: UserNotificationJobData): Promise<string> {
  const queue = getUserNotificationsQueue()
  // Use event ID for idempotency - same event won't be processed twice
  const jobId = `user-notify-${data.eventId}`
  const job = await queue.add(`user-${data.eventType}`, data, {
    jobId,
  })
  return job.id!
}
