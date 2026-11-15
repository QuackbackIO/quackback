import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  sendChangelogPublishedEmail,
  sendNewCommentEmail,
  sendPostMentionEmail,
  sendStatusChangeEmail,
  sendStatusIncidentPublishedEmail,
  sendStatusMaintenanceScheduledEmail,
  type EmailResult,
  type SendingIdentity,
} from '../index'
import { sendingAs } from './brands'

/**
 * Feedback, changelog and status mail can leave from the workspace's own
 * address for that surface, under a display name. Read off the Resend payload,
 * so each case pins what would go over the wire.
 */

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('resend')>()
  return {
    ...actual,
    Resend: class {
      emails = { send: resendSend }
    },
  }
})

const ENV_KEYS = [
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_SMTP_HOST',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_INBOUND_PROVIDER',
  'EMAIL_FROM',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.EMAIL_RESEND_API_KEY = 're_test'
  process.env.EMAIL_FROM = 'Platform <noreply@platform.test>'
  resendSend.mockReset()
  resendSend.mockResolvedValue({ data: { id: 'resend-email-id' }, error: null, headers: null })
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
})

type Envelope = { from?: SendingIdentity; fromDisplayName?: string }

const common = {
  to: 'customer@example.test',
  workspaceName: 'Acme',
  unsubscribeUrl: 'https://acme.test/unsubscribe?token=t',
}

const senders: Array<[string, (e: Envelope) => Promise<EmailResult>]> = [
  [
    'status change',
    (e) =>
      sendStatusChangeEmail({
        ...common,
        ...e,
        postTitle: 'Dark mode',
        postUrl: 'https://acme.test/p/1',
        previousStatus: 'open',
        newStatus: 'planned',
      }),
  ],
  [
    'new comment',
    (e) =>
      sendNewCommentEmail({
        ...common,
        ...e,
        postTitle: 'Dark mode',
        postUrl: 'https://acme.test/p/1',
        commenterName: 'Sam',
        commentPreview: 'Looks good',
        isTeamMember: false,
      }),
  ],
  [
    'post mention',
    (e) =>
      sendPostMentionEmail({
        ...common,
        ...e,
        mentionerName: 'Sam',
        postTitle: 'Dark mode',
        excerpt: '',
        postUrl: 'https://acme.test/p/1',
      }),
  ],
  [
    'changelog',
    (e) =>
      sendChangelogPublishedEmail({
        ...common,
        ...e,
        changelogTitle: 'May release',
        changelogUrl: 'https://acme.test/changelog',
        contentPreview: 'New things',
      }),
  ],
  [
    'status incident',
    (e) =>
      sendStatusIncidentPublishedEmail({
        ...common,
        ...e,
        incidentTitle: 'API errors',
        impact: 'minor',
        statusLabel: 'Investigating',
        body: 'Looking into it',
        affectedComponents: [{ name: 'API', status: 'Degraded' }],
        incidentUrl: 'https://acme.test/status/1',
      }),
  ],
  [
    'status maintenance',
    (e) =>
      sendStatusMaintenanceScheduledEmail({
        ...common,
        ...e,
        maintenanceTitle: 'Database upgrade',
        body: 'Short window',
        startLabel: 'July 12, 2026 at 02:00 UTC',
        endLabel: 'July 12, 2026 at 03:00 UTC',
        affectedComponents: ['API'],
        incidentUrl: 'https://acme.test/status/2',
      }),
  ],
]

describe.each(senders)('%s email', (_name, send) => {
  it('sends from the given address under the given name', async () => {
    await send({ from: sendingAs('updates@acme.test'), fromDisplayName: 'Acme' })
    expect(resendSend.mock.calls[0][0].from).toBe('Acme <updates@acme.test>')
  })

  it('names the platform address when no address is given', async () => {
    await send({ fromDisplayName: 'Acme' })
    expect(resendSend.mock.calls[0][0].from).toBe('Acme <noreply@platform.test>')
  })

  it('names the platform address for the workspace with neither', async () => {
    await send({})
    expect(resendSend.mock.calls[0][0].from).toBe('Acme <noreply@platform.test>')
  })
})
