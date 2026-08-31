import { db, emailLog, and, eq, gte, inArray, lt, sql } from '@/lib/server/db'
import { METERED_EMAIL_TYPES } from '@quackback/email'

export async function emailsSentThisMonth(): Promise<number> {
  return emailsSentInUtcMonth(new Date())
}

/** Count changelog and status-page subscriber sends, not the stored billable flag. */
export async function emailsSentInUtcMonth(at: Date): Promise<number> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.direction, 'outbound'),
        eq(emailLog.status, 'sent'),
        inArray(emailLog.emailType, [...METERED_EMAIL_TYPES]),
        gte(emailLog.createdAt, start),
        lt(emailLog.createdAt, end)
      )
    )
  return row?.count ?? 0
}
