import { setEmailLogSink, type EmailLogSinkEntry } from '@quackback/email'
import type { ConversationId, TicketId } from '@quackback/ids'
import { db, emailLog } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'email-log' })

const SUBJECT_MAX = 500

async function writeOutbound(entry: EmailLogSinkEntry): Promise<void> {
  try {
    await db.insert(emailLog).values({
      direction: entry.direction,
      emailType: entry.emailType,
      provider: entry.provider,
      messageId: entry.messageId ?? null,
      address: entry.to,
      subject: entry.subject.slice(0, SUBJECT_MAX),
      status: entry.status,
      error: entry.error ?? null,
      billable: entry.billable,
    })
  } catch (err) {
    log.warn({ err, email_type: entry.emailType, status: entry.status }, 'email log write failed')
  }
}

let registered = false

export async function recordInboundEmailLog(entry: {
  emailType: string
  address: string
  subject?: string | null
  conversationId?: string | null
  ticketId?: string | null
  status: 'received' | 'rejected'
  error?: string | null
  messageId?: string | null
}): Promise<void> {
  try {
    await db.insert(emailLog).values({
      direction: 'inbound',
      emailType: entry.emailType,
      address: entry.address,
      subject: entry.subject?.slice(0, SUBJECT_MAX) ?? null,
      conversationId: (entry.conversationId as ConversationId | null) ?? null,
      ticketId: (entry.ticketId as TicketId | null) ?? null,
      status: entry.status,
      error: entry.error ?? null,
      messageId: entry.messageId ?? null,
      billable: false,
    })
  } catch (err) {
    log.warn(
      { err, email_type: entry.emailType, status: entry.status },
      'inbound email log write failed'
    )
  }
}

export function ensureEmailLogSink(): void {
  if (registered) return
  registered = true
  setEmailLogSink((entry) => {
    void writeOutbound(entry)
  })
}
