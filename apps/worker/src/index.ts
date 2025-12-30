import { Worker } from 'bullmq'
import {
  getConnection,
  QueueNames,
  type ImportJobData,
  type ImportJobResult,
  type EventJobData,
  type EventJobResult,
} from '@quackback/jobs'
import {
  parseCSV,
  processBatch,
  validateJobData,
  mergeResults,
  BATCH_SIZE,
  processEvent,
} from '@quackback/jobs/processors'

console.log('Starting Quackback Worker...')

// Create import worker
const importWorker = new Worker<ImportJobData, ImportJobResult>(
  QueueNames.IMPORT,
  async (job) => {
    console.log(`[Import] Processing job ${job.id}`)

    // Validate job data
    const validation = validateJobData(job.data)
    if (!validation.success) {
      throw new Error(`Invalid job data: ${validation.error}`)
    }

    // Parse CSV
    const rows = parseCSV(job.data.csvContent)
    let result: ImportJobResult = { imported: 0, skipped: 0, errors: [], createdTags: [] }

    // Process in batches with progress updates
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const batchResult = await processBatch(batch, job.data.boardId, i)
      result = mergeResults(result, batchResult)

      // Report progress
      await job.updateProgress({
        processed: Math.min(i + BATCH_SIZE, rows.length),
        total: job.data.totalRows,
      })
    }

    return result
  },
  {
    connection: getConnection(),
    concurrency: 2,
  }
)

// Create events worker - processes domain events for integrations and notifications
const eventsWorker = new Worker<EventJobData, EventJobResult>(
  QueueNames.EVENTS,
  async (job) => {
    console.log(`[Events] Processing ${job.data.type} event ${job.data.id}`)
    return processEvent(job.data)
  },
  {
    connection: getConnection(),
    concurrency: 10,
  }
)

// Import worker event handlers
importWorker.on('completed', (job, result) => {
  console.log(
    `[Import] Job ${job.id} completed: ${result.imported} imported, ${result.skipped} skipped`
  )
})

importWorker.on('failed', (job, err) => {
  console.error(`[Import] Job ${job?.id} failed:`, err.message)
})

importWorker.on('progress', (job, progress) => {
  const p = progress as { processed: number; total: number }
  console.log(`[Import] Job ${job.id} progress: ${p.processed}/${p.total}`)
})

importWorker.on('error', (err) => {
  console.error('[Import] Worker error:', err)
})

// Events worker event handlers
eventsWorker.on('completed', (job, result) => {
  console.log(
    `[Events] Job ${job.id} completed: ${result.integrationsProcessed} integrations, ${result.notificationsSent} notifications`
  )
})

eventsWorker.on('failed', (job, err) => {
  console.error(`[Events] Job ${job?.id} failed:`, err.message)
})

eventsWorker.on('error', (err) => {
  console.error('[Events] Worker error:', err)
})

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down worker...')
  await Promise.all([importWorker.close(), eventsWorker.close()])
  console.log('Worker shut down gracefully')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('Worker started and listening for jobs...')
