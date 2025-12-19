import { Queue } from 'bullmq'
import { getConnection } from './connection'
import type { ImportJobData, ImportJobResult } from './types'

/**
 * Queue names using curly brace notation for DragonflyDB cluster compatibility
 * The {prefix} ensures all keys for this queue are on the same shard
 */
export const QueueNames = {
  IMPORT: '{import}',
  EVENTS: '{events}',
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
    jobId: `import-${data.workspaceId}-${Date.now()}`,
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
}
