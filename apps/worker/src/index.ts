import { Worker } from 'bullmq'
import {
  getConnection,
  QueueNames,
  getStateAdapter,
  type ImportJobData,
  type ImportJobResult,
  type EventJobData,
  type EventJobResult,
} from '@quackback/jobs'
import { processImportJob } from './processors/import'
import { processEvent } from '@quackback/jobs/processors'

console.log('Starting Quackback Worker...')

// Create import worker
const importWorker = new Worker<ImportJobData, ImportJobResult>(
  QueueNames.IMPORT,
  async (job) => {
    console.log(`[Import] Processing job ${job.id}`)
    return processImportJob(job)
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
    const stateAdapter = getStateAdapter()
    return processEvent(job.data, stateAdapter)
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
