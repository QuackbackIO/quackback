/**
 * The automated mails that sit inside a customer's support thread (the cold
 * inbound acknowledgement and the rating request) leave with the same envelope
 * as an agent's reply: the thread's From under the workspace's name, the
 * conversation's Reply-To, the threading headers, and a subject that matches
 * the thread. Checked on the wire, at the transport, so nothing between the
 * sender and the provider can drop a field unseen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMailMock = vi.fn().mockResolvedValue({ messageId: '<sent@smtp.example>' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

import { sendConversationAutoAckEmail, sendCsatRequestEmail, sendTicketEventEmail } from '../index'
import { sendingAs } from './brands'

const ENV_KEYS = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
  process.env.EMAIL_FROM = 'noreply@platform.example'
  sendMailMock.mockClear()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const RATINGS = [1, 2, 3, 4, 5].map((r) => `https://portal.example/csat?rating=${r}`) as [
  string,
  string,
  string,
  string,
  string,
]

/** What the transport was handed, with a named From read as `Name <addr>`. */
function wire(): Record<string, unknown> {
  expect(sendMailMock).toHaveBeenCalledTimes(1)
  const call = sendMailMock.mock.calls[0][0] as Record<string, unknown>
  const from = call.from as string | { name: string; address: string }
  return { ...call, from: typeof from === 'string' ? from : `${from.name} <${from.address}>` }
}

describe('sendConversationAutoAckEmail', () => {
  it("sends as the thread's address under the given name", async () => {
    await sendConversationAutoAckEmail({
      to: 'customer@example.org',
      workspaceName: 'Example Co',
      conversationSubject: 'Help with billing',
      from: sendingAs('help@home.example'),
      fromDisplayName: 'Example Co',
    })
    expect(wire()).toMatchObject({
      from: 'Example Co <help@home.example>',
      subject: 'Re: Help with billing',
    })
  })

  it('names the platform default when the thread has no address of its own', async () => {
    await sendConversationAutoAckEmail({
      to: 'customer@example.org',
      workspaceName: 'Example Co',
      fromDisplayName: 'Example Co',
    })
    expect(wire().from).toBe('Example Co <noreply@platform.example>')
  })
})

describe('sendCsatRequestEmail', () => {
  it('threads into the conversation like every other mail on it', async () => {
    await sendCsatRequestEmail({
      to: 'customer@example.org',
      promptText: 'How did we do?',
      ratingUrls: RATINGS,
      workspaceName: 'Example Co',
      conversationSubject: 'Help with billing',
      from: sendingAs('help@home.example'),
      fromDisplayName: 'Example Co',
      replyTo: 'reply+c1@mail.platform.example',
      messageId: '<c.1.csat@mail.platform.example>',
      inReplyTo: '<cust@example.org>',
      references: ['<cust@example.org>', '<c.1.ack@mail.platform.example>'],
    })
    expect(wire()).toMatchObject({
      from: 'Example Co <help@home.example>',
      subject: 'Re: Help with billing',
      replyTo: 'reply+c1@mail.platform.example',
      messageId: '<c.1.csat@mail.platform.example>',
      inReplyTo: '<cust@example.org>',
      references: '<cust@example.org> <c.1.ack@mail.platform.example>',
    })
  })

  it('falls back to a reply subject naming the workspace when the thread has none', async () => {
    await sendCsatRequestEmail({
      to: 'customer@example.org',
      promptText: '',
      ratingUrls: RATINGS,
      workspaceName: 'Example Co',
      fromDisplayName: 'Example Co',
    })
    expect(wire()).toMatchObject({
      from: 'Example Co <noreply@platform.example>',
      subject: 'Re: your conversation with Example Co',
    })
  })
})

describe('sendTicketEventEmail', () => {
  const ticket = {
    to: 'customer@example.org',
    kind: 'created' as const,
    workspaceName: 'Example Co',
    ticketLabel: '#1',
    title: 'Cannot sign in',
    ctaUrl: 'https://portal.example/tickets/1',
  }

  it('names the ticket address after the workspace', async () => {
    await sendTicketEventEmail({
      ...ticket,
      from: sendingAs('help@home.example'),
      fromDisplayName: 'Example Co',
    })
    expect(wire().from).toBe('Example Co <help@home.example>')
  })

  it('names the platform default when the address was refused at send', async () => {
    await sendTicketEventEmail({ ...ticket, fromDisplayName: 'Example Co' })
    expect(wire().from).toBe('Example Co <noreply@platform.example>')
  })
})
