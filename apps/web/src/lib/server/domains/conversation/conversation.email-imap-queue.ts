/**
 * IMAP inbound poller — a ~60s repeatable job that pulls unseen mail from a
 * configured IMAP mailbox and feeds it to the shared ingest core (Layer 1 for
 * self-hosters, no provider webhook required).
 *
 * Gated on config: when EMAIL_INBOUND_PROVIDER is not `imap` (or credentials
 * are incomplete) the worker never initializes — no queue, no connection. When
 * it does run it mirrors the webhook's conversations-enabled gate before
 * ingesting.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { logger } from '@/lib/server/logger'
import { readImapConfig, createImapClient, pollOnce } from './conversation.email-imap'

const log = logger.child({ component: 'email-imap-queue' })

const QUEUE_NAME = '{email-imap}'
const CONCURRENCY = 1
const POLL_INTERVAL_MS = 60_000

interface EmailImapJob {
  type: 'poll'
}

let initPromise: Promise<{
  queue: Queue<EmailImapJob>
  worker: Worker<EmailImapJob>
}> | null = null

async function runPoll(): Promise<void> {
  const config = readImapConfig(process.env)
  if (!config) return

  // Same gate the webhook applies: when no visitor surface is enabled, replies
  // have nowhere to land.
  const { isConversationsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  if (!(await isConversationsEnabled())) return

  const { ingestParsedEmail } = await import('./conversation.email-inbound.service')
  const client = await createImapClient(config)
  try {
    const result = await pollOnce(client, ingestParsedEmail)
    if (result.ingested > 0 || result.failed > 0) {
      log.info(result, 'imap poll complete')
    }
  } finally {
    await client.close().catch(() => {})
  }
}

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<EmailImapJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1, // a failed poll just retries on the next tick
      removeOnComplete: { count: 50, age: 86400 },
      removeOnFail: { age: 86400 },
    },
  })

  const worker = new Worker<EmailImapJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === 'poll') await runPoll()
    },
    { connection, concurrency: CONCURRENCY }
  )

  // Stable jobId so worker reboots dedupe instead of stacking cron entries.
  await queue.add(
    'email-imap:poll',
    { type: 'poll' },
    {
      jobId: 'email-imap:poll',
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: { count: 50 },
      removeOnFail: { age: 86400 },
    }
  )

  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), REDIS_READY_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    await queue.close().catch(() => {})
    await worker.close().catch(() => {})
    throw error
  }

  worker.on('failed', (job, error) => {
    if (!job) return
    log.error({ err: error }, 'imap poll job failed')
  })

  return { queue, worker }
}

/**
 * Initialize the IMAP poller eagerly (called from startup). No-op — never
 * connecting to Redis or IMAP — unless the IMAP inbound provider is configured.
 */
export async function initEmailImapWorker(): Promise<void> {
  if (!readImapConfig(process.env)) {
    log.debug('imap inbound not configured; poller disabled')
    return
  }
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('imap inbound poller initialized')
}

export async function closeEmailImapQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker.close().catch(() => {})
  await queue.close().catch(() => {})
}
