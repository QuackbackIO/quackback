import { Worker } from 'bullmq'
import {
  getConnection,
  QueueNames,
  type ImportJobData,
  type ImportJobResult,
} from '@quackback/jobs'
import { processImportJob } from './processors/import'

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
    concurrency: 2, // Process 2 jobs in parallel
  }
)

// Event handlers
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

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down worker...')
  await importWorker.close()
  console.log('Worker shut down gracefully')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('Worker started and listening for jobs...')
