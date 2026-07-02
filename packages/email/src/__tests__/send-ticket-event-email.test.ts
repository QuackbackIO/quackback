import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'ticket-msg-id' })
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}))

import { sendTicketEventEmail } from '../index'

const ENV_KEYS = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASS',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
]

describe('sendTicketEventEmail', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
    process.env.EMAIL_FROM = 'noreply@example.com'
    sendMailMock.mockClear()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key]
      } else {
        delete process.env[key]
      }
    }
  })

  it('renders structured ticket details and quote content', async () => {
    const result = await sendTicketEventEmail({
      to: 'customer@example.com',
      title: 'New reply: Billing question',
      summary: 'The requester replied to this ticket.',
      eventLabel: 'New reply',
      actorName: 'Alex Morgan',
      occurredAt: 'Jun 16, 2026, 10:15 AM',
      ticketSubject: 'Billing question',
      ticketUrl: 'https://example.com/tickets/ticket_123',
      workspaceName: 'Acme',
      unsubscribeUrl: 'https://example.com/settings/notifications',
      statusLabel: 'Open',
      priorityLabel: 'High',
      details: [
        { label: 'Current status', value: 'Open' },
        { label: 'Priority', value: 'High' },
        { label: 'Requester', value: 'Jamie (jamie@example.com)' },
      ],
      contentSections: [
        {
          title: 'Requester reply',
          body: 'I can share the invoice number if that helps.\n\nHere is the full context from the customer.',
          tone: 'quote',
        },
        {
          title: 'Attachment details',
          rows: [
            { label: 'File', value: 'invoice.pdf' },
            { label: 'Size', value: '1.5 KB' },
          ],
        },
      ],
      quote: 'I can share the invoice number if that helps.',
    })

    expect(result).toEqual({ sent: true })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0] as {
      to: string
      subject: string
      html: string
      from: string
    }
    expect(call.to).toBe('customer@example.com')
    expect(call.subject).toBe('New reply: Billing question')
    expect(call.html).toContain('The requester replied to this ticket.')
    expect(call.html).toContain('New reply')
    expect(call.html).toContain('Alex Morgan')
    expect(call.html).toContain('Billing question')
    expect(call.html).toContain('Current status')
    expect(call.html).toContain('Action content')
    expect(call.html).toContain('Requester reply')
    expect(call.html).toContain('Here is the full context from the customer.')
    expect(call.html).toContain('Attachment details')
    expect(call.html).toContain('invoice.pdf')
    expect(call.html).toContain('Current ticket')
    expect(call.html).toContain('Jamie (jamie@example.com)')
    expect(call.html).toContain('I can share the invoice number if that helps.')
    expect(call.html).toContain('https://example.com/tickets/ticket_123')
    expect(call.html).toContain('https://example.com/settings/notifications')
  })
})
