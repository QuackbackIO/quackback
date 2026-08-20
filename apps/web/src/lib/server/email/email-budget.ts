import { db, emailLog, and, eq, gte, sql } from '@/lib/server/db'

export async function emailsSentThisMonth(): Promise<number> {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.direction, 'outbound'),
        eq(emailLog.status, 'sent'),
        eq(emailLog.billable, true),
        gte(emailLog.createdAt, start)
      )
    )
  return row?.count ?? 0
}
