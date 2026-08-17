/**
 * Provider delivery events (bounce / complaint) onto email_log rows.
 * Matches on the stored Message-ID or provider message id.
 */
import { logger } from '@/lib/server/logger'
import { recordEmailDeliveryEvent } from './email-log.query'

const log = logger.child({ component: 'email-delivery-events' })

export function parseDeliveryEvent(body: unknown): {
  messageId: string
  event: 'bounce' | 'complaint'
} | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>

  // Resend: { type: 'email.bounced' | 'email.complained', data: { email_id } }
  if (typeof rec.type === 'string' && rec.data && typeof rec.data === 'object') {
    const data = rec.data as Record<string, unknown>
    const id =
      (typeof data.email_id === 'string' && data.email_id) ||
      (typeof data.message_id === 'string' && data.message_id) ||
      null
    if (id && rec.type === 'email.bounced') return { messageId: id, event: 'bounce' }
    if (id && rec.type === 'email.complained') return { messageId: id, event: 'complaint' }
  }

  // SES SNS: { notificationType: 'Bounce' | 'Complaint', mail: { messageId } }
  // or wrapped { Type: 'Notification', Message: '<json>' }
  const ses = unwrapSns(rec)
  if (ses) {
    const mail =
      ses.mail && typeof ses.mail === 'object' ? (ses.mail as Record<string, unknown>) : null
    const id = typeof mail?.messageId === 'string' ? mail.messageId : null
    if (id && ses.notificationType === 'Bounce') return { messageId: id, event: 'bounce' }
    if (id && ses.notificationType === 'Complaint') return { messageId: id, event: 'complaint' }
  }

  return null
}

function unwrapSns(rec: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof rec.notificationType === 'string') return rec
  if (rec.Type === 'Notification' && typeof rec.Message === 'string') {
    try {
      const inner = JSON.parse(rec.Message) as unknown
      if (inner && typeof inner === 'object') return inner as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

export async function applyDeliveryEvent(body: unknown): Promise<boolean> {
  const parsed = parseDeliveryEvent(body)
  if (!parsed) return false
  const ok = await recordEmailDeliveryEvent(parsed)
  if (ok) log.info({ event: parsed.event }, 'recorded email delivery event')
  return ok
}
