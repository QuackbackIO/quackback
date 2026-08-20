import { db, desc, eq, or, emailLog } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'email-log-query' })

export type EmailLogListItem = {
  id: string
  direction: string
  emailType: string
  status: string
  createdAt: string
}

export async function listRecentEmailLog(limit = 50): Promise<EmailLogListItem[]> {
  try {
    const rows = await db
      .select({
        id: emailLog.id,
        direction: emailLog.direction,
        emailType: emailLog.emailType,
        status: emailLog.status,
        createdAt: emailLog.createdAt,
      })
      .from(emailLog)
      .orderBy(desc(emailLog.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100))
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      emailType: r.emailType,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }))
  } catch (err) {
    log.warn({ err }, 'list email log failed')
    return []
  }
}

export async function recordEmailDeliveryEvent(input: {
  messageId: string
  event: 'bounce' | 'complaint'
}): Promise<boolean> {
  const id = input.messageId.replace(/^<|>$/g, '').trim()
  if (!id) return false
  try {
    const [row] = await db
      .select({ id: emailLog.id })
      .from(emailLog)
      .where(or(eq(emailLog.messageId, id), eq(emailLog.providerMessageId, id)))
      .limit(1)
    if (!row) return false
    await db
      .update(emailLog)
      .set({
        status: input.event === 'bounce' ? 'bounced' : 'complaint',
        error: input.event,
      })
      .where(eq(emailLog.id, row.id))
    return true
  } catch (err) {
    log.warn({ err, event: input.event }, 'email delivery event write failed')
    return false
  }
}
