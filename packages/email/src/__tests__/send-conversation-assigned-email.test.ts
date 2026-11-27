import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock nodemailer so we can capture sendMail invocations without opening a real SMTP socket.
const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' })
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}))

import { sendConversationAssignedEmail } from '../index'

const ENV_KEYS = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASS',
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_FROM',
]

describe('sendConversationAssignedEmail', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    // Force SMTP provider so the helper renders + calls sendMail.
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

  it('tells the assignee, with the customer, subject and inbox link', async () => {
    const result = await sendConversationAssignedEmail({
      to: 'agent@example.com',
      assignedToYou: true,
      customerName: 'Jane',
      preview: 'Cannot log in',
      conversationUrl: 'https://w.example/admin/inbox?i=conversation_1',
      workspaceName: 'Acme Support',
      preferencesUrl: 'https://w.example/settings/preferences',
    })

    expect(result).toEqual({ sent: true })
    const call = sendMailMock.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(call.to).toBe('agent@example.com')
    expect(call.subject).toBe('A conversation was assigned to you')
    expect(call.html).toContain('A conversation with Jane was assigned to you.')
    expect(call.html).toContain('Cannot log in')
    expect(call.html).toContain('https://w.example/admin/inbox?i=conversation_1')
    expect(call.html).toContain('https://w.example/settings/preferences')
    expect(call.html).not.toContain('/unsubscribe')
  })

  it('words a team assignment for the team', async () => {
    await sendConversationAssignedEmail({
      to: 'member@example.com',
      assignedToYou: false,
      preview: '',
      conversationUrl: 'https://w.example/admin/inbox?i=conversation_1',
      workspaceName: 'Acme Support',
    })

    const call = sendMailMock.mock.calls[0][0] as { subject: string; html: string }
    expect(call.subject).toBe('A conversation was assigned to your team')
    expect(call.html).toContain('A conversation was assigned to your team.')
  })
})
