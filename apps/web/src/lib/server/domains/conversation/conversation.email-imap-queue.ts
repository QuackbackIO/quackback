/**
 * IMAP inbound poller — a once-a-minute job that pulls unseen mail from a
 * configured IMAP mailbox and feeds it to the shared ingest core (Layer 1 for
 * self-hosters, no provider webhook required).
 *
 * Under BullMQ this was a repeatable job with `every: 60_000`; here it is a
 * `* * * * *` cron on the job definition. Same cadence, and the same
 * once-per-slot guarantee, now enforced by the unique index on
 * `(queue, dedupe_key)` rather than by a stable BullMQ job id.
 *
 * **The gate moved from construction to scheduling, deliberately.** The old
 * shape simply never built the worker when IMAP was unconfigured. A cron that
 * enqueued anyway and returned early from the handler would write 1,440 no-op
 * rows a day per tenant, so `isEmailImapPollable()` gates the schedule instead:
 * nothing is written at all.
 *
 * **It refuses to schedule under pooled tenancy, and that is the honest
 * answer.** The mailbox is configured from process environment — one mailbox
 * for the whole process — while the queue is per tenant. Scheduling it on every
 * tenant's loop would have each tenant poll the *same* mailbox and ingest the
 * same message into its own database. That is a cross-tenant data movement, so
 * it fails closed and says why. It is not a regression: under pooled tenancy
 * the BullMQ worker was never started either (`startup.ts` refuses the whole
 * registry), so this replaces a silent absence with a stated refusal.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { readImapConfig, createImapClient, pollOnce } from './conversation.email-imap'
import { isConversationsEnabled } from '@/lib/server/domains/settings/settings.support'
import { ingestParsedEmail } from './conversation.email-inbound.service'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

const log = logger.child({ component: 'email-imap-queue' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const EMAIL_IMAP_QUEUE = 'email-imap'

let warnedPooled = false

/**
 * Whether the poll schedule should be live at all.
 *
 * Read per tick rather than once at boot so an operator who configures the
 * mailbox does not have to restart, matching what a lazily-initialised worker
 * would have done on its first enqueue.
 */
export function isEmailImapPollable(): boolean {
  if (!readImapConfig(process.env)) return false
  if (config.isPooledTenancy) {
    if (!warnedPooled) {
      warnedPooled = true
      log.error(
        'IMAP inbound is configured from process environment but the queue is per tenant — ' +
          'polling one shared mailbox from every tenant loop would ingest the same message ' +
          'into every database. The poller is NOT scheduled under pooled tenancy.'
      )
    }
    return false
  }
  return true
}

/** Poll the mailbox once. */
export async function runEmailImapPoll(_job: ClaimedJob): Promise<void> {
  const imap = readImapConfig(process.env)
  if (!imap) return

  // Same gate the webhook applies: when no visitor surface is enabled, replies
  // have nowhere to land.
  if (!(await isConversationsEnabled())) return

  const client = await createImapClient(imap)
  try {
    const result = await pollOnce(client, ingestParsedEmail)
    if (result.ingested > 0 || result.failed > 0) {
      log.info(result, 'imap poll complete')
    }
  } finally {
    await client.close().catch(() => {})
  }
}
