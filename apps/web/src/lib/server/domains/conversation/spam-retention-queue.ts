/**
 * Spam retention — a daily job that deletes machine-filed spam conversations
 * past the retention window (see conversation.spam-retention.ts, which states
 * the window and why it is what it is).
 *
 * Runs on the Postgres job queue (`lib/server/jobs`). Schedule and retry policy
 * live in `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { sweepFiledSpamConversations } from './conversation.spam-retention'

const log = logger.child({ component: 'spam-retention' })

export async function runSpamRetention(): Promise<void> {
  const result = await sweepFiledSpamConversations()
  if (result.deleted > 0) {
    log.debug({ deleted: result.deleted }, 'spam-retention run complete')
  }
}
