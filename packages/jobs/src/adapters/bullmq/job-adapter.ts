/**
 * BullMQ job adapter for OSS/self-hosted deployments.
 *
 * Uses BullMQ queues backed by Redis for job processing.
 * This adapter is used when running in Node.js/Bun environment.
 */

import { Queue } from 'bullmq'
import { getConnection } from '../../connection'
import type { JobAdapter } from '../types'
import type {
  ImportJobData,
  ImportJobResult,
  ImportJobStatus,
  EventJobData,
  EventJobResult,
} from '../../types'

/**
 * Queue names using curly brace notation for DragonflyDB cluster compatibility.
 * The {prefix} ensures all keys for this queue are on the same shard.
 */
export const QueueNames = {
  IMPORT: '{import}',
  EVENTS: '{events}',
} as const

/**
 * BullMQ implementation of the JobAdapter interface.
 */
export class BullMQJobAdapter implements JobAdapter {
  private _importQueue: Queue<ImportJobData, ImportJobResult> | null = null
  private _eventsQueue: Queue<EventJobData, EventJobResult> | null = null

  /**
   * Get or create the import queue instance.
   */
  private getImportQueue(): Queue<ImportJobData, ImportJobResult> {
    if (!this._importQueue) {
      this._importQueue = new Queue<ImportJobData, ImportJobResult>(QueueNames.IMPORT, {
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
    return this._importQueue
  }

  /**
   * Get or create the events queue instance.
   */
  private getEventsQueue(): Queue<EventJobData, EventJobResult> {
    if (!this._eventsQueue) {
      this._eventsQueue = new Queue<EventJobData, EventJobResult>(QueueNames.EVENTS, {
        connection: getConnection(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 24 * 3600,
            count: 1000,
          },
          removeOnFail: {
            age: 7 * 24 * 3600,
          },
        },
      })
    }
    return this._eventsQueue
  }

  async addImportJob(data: ImportJobData): Promise<string> {
    const queue = this.getImportQueue()
    const job = await queue.add('import-posts', data, {
      jobId: `import-${data.organizationId}-${Date.now()}`,
    })
    return job.id!
  }

  async getImportJobStatus(jobId: string): Promise<ImportJobStatus | null> {
    const queue = this.getImportQueue()
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

  async addEventJob(data: EventJobData): Promise<string> {
    const queue = this.getEventsQueue()
    const job = await queue.add(`event-${data.type}`, data, {
      jobId: `event-${data.organizationId}-${data.id}`,
    })
    return job.id!
  }

  // Legacy methods - kept for interface compatibility but use addEventJob instead
  async addIntegrationJob(): Promise<string> {
    throw new Error('addIntegrationJob is deprecated. Use addEventJob instead.')
  }

  async addUserNotificationJob(): Promise<string> {
    throw new Error('addUserNotificationJob is deprecated. Use addEventJob instead.')
  }

  async close(): Promise<void> {
    const closePromises: Promise<void>[] = []

    if (this._importQueue) {
      closePromises.push(this._importQueue.close())
      this._importQueue = null
    }
    if (this._eventsQueue) {
      closePromises.push(this._eventsQueue.close())
      this._eventsQueue = null
    }

    await Promise.all(closePromises)
  }
}
