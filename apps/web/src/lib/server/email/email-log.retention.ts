import { db, emailLog, lt } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'email-log-retention' })

const DEFAULT_RETENTION_DAYS = 90

/** Prune ledger rows older than the window. Monthly counts should be rolled up first (M5). */
export async function runEmailLogRetention(): Promise<void> {
  await pruneEmailLog()
}

export async function pruneEmailLog(retentionDays = DEFAULT_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const deleted = await db
    .delete(emailLog)
    .where(lt(emailLog.createdAt, cutoff))
    .returning({ id: emailLog.id })
  const count = deleted.length
  log.info({ pruned: count, retention_days: retentionDays }, 'email log retention sweep')
  return count
}
