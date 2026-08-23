import { db, emailLog, and, eq, gte, lt, sql } from '@/lib/server/db'

export async function emailsSentThisMonth(): Promise<number> {
  return emailsSentInUtcMonth(new Date())
}

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
        eq(emailLog.billable, true),
        gte(emailLog.createdAt, start),
        lt(emailLog.createdAt, end)
      )
    )
  return row?.count ?? 0
}
