import { Worker } from 'bullmq'
import {
  getConnection,
  QueueNames,
  type ImportJobData,
  type ImportJobResult,
  type IntegrationJobData,
  type IntegrationJobResult,
  type UserNotificationJobData,
  type UserNotificationJobResult,
} from '@quackback/jobs'
import { processImportJob } from './processors/import'
import { processIntegrationJob } from './processors/integrations'
import { processUserNotificationJob } from './processors/user-notifications'

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

// Create integration worker
const integrationWorker = new Worker<IntegrationJobData, IntegrationJobResult>(
  QueueNames.INTEGRATIONS,
  async (job) => {
    console.log(`[Integration] Processing job ${job.id}`)
    return processIntegrationJob(job)
  },
  {
    connection: getConnection(),
    concurrency: 20, // Higher concurrency for integration jobs
  }
)

// Create user notification worker
const userNotificationWorker = new Worker<UserNotificationJobData, UserNotificationJobResult>(
  QueueNames.USER_NOTIFICATIONS,
  async (job) => {
    console.log(`[UserNotification] Processing job ${job.id}`)
    return processUserNotificationJob(job)
  },
  {
    connection: getConnection(),
    concurrency: 10, // Moderate concurrency for email sending
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

// Integration worker event handlers
integrationWorker.on('completed', (job, result) => {
  console.log(`[Integration] Job ${job.id} completed: ${result.success ? 'success' : 'failed'}`)
})

integrationWorker.on('failed', (job, err) => {
  console.error(`[Integration] Job ${job?.id} failed:`, err.message)
})

integrationWorker.on('error', (err) => {
  console.error('[Integration] Worker error:', err)
})

// User notification worker event handlers
userNotificationWorker.on('completed', (job, result) => {
  console.log(
    `[UserNotification] Job ${job.id} completed: ${result.emailsSent} sent, ${result.skipped} skipped`
  )
})

userNotificationWorker.on('failed', (job, err) => {
  console.error(`[UserNotification] Job ${job?.id} failed:`, err.message)
})

userNotificationWorker.on('error', (err) => {
  console.error('[UserNotification] Worker error:', err)
})

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down worker...')
  await Promise.all([
    importWorker.close(),
    integrationWorker.close(),
    userNotificationWorker.close(),
  ])
  console.log('Worker shut down gracefully')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('Worker started and listening for jobs...')
