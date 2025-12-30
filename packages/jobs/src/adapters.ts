/**
 * Job adapters for BullMQ.
 *
 * This file provides job queue management using BullMQ.
 */

import { Queue } from 'bullmq'
import { getConnection } from './connection'
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
// Adapter Wrappers (for backwards compatibility)
// ============================================================================

let _jobAdapter: JobAdapter | null = null

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

  await Promise.all(closePromises)
}
