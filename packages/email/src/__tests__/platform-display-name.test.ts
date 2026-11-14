import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as email from '../index'
import type { EmailResult } from '../index'
import { platformDisplayName } from '../platform-name'
import type { ContactEmail } from '../recipient'
import { sealedTo } from './brands'

/**
 * Mail that leaves from the platform address must not carry the platform
 * registry's display name to a workspace's own people. Every sender the package
 * exports is driven through the shared send point here with the registry's From
 * installed, and the From that would go over the wire is read off the Resend
 * payload.
 *
 * The table is checked against the module's exports, so a new sender without a
 * case fails this suite instead of quietly shipping under the registry name.
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

const REGISTRY_FROM = 'Quackback Cloud <noreply@mail.quackback.io>'
const PLATFORM_ADDRESS = 'noreply@mail.quackback.io'

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
  resendSend.mockReset()
  resendSend.mockResolvedValue({ data: { id: 'resend-email-id' }, error: null, headers: null })
})
afterEach(() => {
  email.resetDefaultFromResolver()
  for (const key of ENV_KEYS) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
})

const to = sealedTo('person@example.test')
/** The one sender that takes an unproven address; see sendSignupNotAllowedEmail. */
const typedTo = 'person@example.test' as ContactEmail
const onboardingContent = {
  subject: 'Your workspace is ready',
  unsubscribeUrl: 'https://acme.test/unsubscribe?token=t',
  lang: 'en',
  dir: 'ltr' as const,
  preview: 'Ready',
  heading: 'Ready',
  paragraphs: ['Hello'],
  cta: { label: 'Open', url: 'https://acme.test/admin' },
  footer: { reason: 'You made a workspace', unsubscribeLabel: 'Unsubscribe' },
}
const ratingUrls = ['1', '2', '3', '4', '5'].map((n) => `https://acme.test/r/${n}`) as [
  string,
  string,
  string,
  string,
  string,
]

/**
 * How each sender is driven, given the workspace name (absent = none known),
 * and for the senders whose callers used to name the platform address
 * themselves, that name.
 */
type Drive = (
  workspaceName: string | undefined,
  extra?: { fromDisplayName?: string }
) => Promise<EmailResult>

// `workspaceName!` where the sender's type requires one: the self-hosted case
// below passes undefined on purpose, to prove a missing name never crashes.
const workspaceSenders: Record<string, Drive> = {
  sendInvitationEmail: (w) =>
    email.sendInvitationEmail({
      to,
      invitedByName: 'Sam',
      workspaceName: w!,
      inviteLink: 'https://acme.test/invite',
    }),
  sendPortalInviteEmail: (w) =>
    email.sendPortalInviteEmail({ to, workspaceName: w!, inviteLink: 'https://acme.test/i' }),
  sendMessengerInstallEmail: (w) =>
    email.sendMessengerInstallEmail({
      to,
      senderName: 'Sam',
      workspaceName: w!,
      snippet: '<script></script>',
    }),
  sendMagicLinkEmail: (w) =>
    email.sendMagicLinkEmail({
      to,
      signInUrl: 'https://acme.test/s',
      code: '123456',
      workspaceName: w,
    }),
  sendSignupNotAllowedEmail: (w) =>
    email.sendSignupNotAllowedEmail({ to: typedTo, workspaceName: w }),
  sendPasswordResetEmail: (w) =>
    email.sendPasswordResetEmail({ to, resetLink: 'https://acme.test/reset', workspaceName: w }),
  sendRecoveryCodeUsedEmail: (w) =>
    email.sendRecoveryCodeUsedEmail({ to, workspaceName: w, occurredAt: 'now' }),
  sendNewSignInEmail: (w) => email.sendNewSignInEmail({ to, workspaceName: w, occurredAt: 'now' }),
  sendVerifyAddressEmail: (w) =>
    email.sendVerifyAddressEmail({ to, code: '123456', workspaceName: w }),
  sendStatusChangeEmail: (w, extra) =>
    email.sendStatusChangeEmail({
      to,
      postTitle: 'Dark mode',
      postUrl: 'https://acme.test/p/1',
      previousStatus: 'open',
      newStatus: 'planned',
      workspaceName: w!,
      ...extra,
      unsubscribeUrl: 'https://acme.test/u',
    }),
  sendNewCommentEmail: (w, extra) =>
    email.sendNewCommentEmail({
      to,
      postTitle: 'Dark mode',
      postUrl: 'https://acme.test/p/1',
      commenterName: 'Sam',
      commentPreview: 'Looks good',
      isTeamMember: false,
      workspaceName: w!,
      ...extra,
      unsubscribeUrl: 'https://acme.test/u',
    }),
  sendConversationMessageEmail: (w) =>
    email.sendConversationMessageEmail({
      to,
      direction: 'visitor_message',
      senderName: 'Visitor',
      messagePreview: 'Hello',
      ctaUrl: 'https://acme.test/admin/inbox',
      workspaceName: w!,
    }),
  sendConversationClosedEmail: (w, extra) =>
    email.sendConversationClosedEmail({ to, workspaceName: w!, ...extra, variant: 'closed' }),
  sendConversationAutoAckEmail: (w, extra) =>
    email.sendConversationAutoAckEmail({ to, workspaceName: w!, ...extra }),
  sendTicketEventEmail: (w, extra) =>
    email.sendTicketEventEmail({
      to,
      kind: 'assigned',
      ticketLabel: '#1',
      title: 'Broken',
      workspaceName: w!,
      ...extra,
      ctaUrl: 'https://acme.test/admin/inbox',
    }),
  sendPostMentionEmail: (w, extra) =>
    email.sendPostMentionEmail({
      to,
      mentionerName: 'Sam',
      postTitle: 'Dark mode',
      excerpt: '',
      postUrl: 'https://acme.test/p/1',
      workspaceName: w!,
      ...extra,
    }),
  sendNoteMentionEmail: (w) =>
    email.sendNoteMentionEmail({
      to,
      authorName: 'Sam',
      preview: 'See this',
      conversationUrl: 'https://acme.test/admin/inbox',
      workspaceName: w!,
    }),
  sendChangelogPublishedEmail: (w, extra) =>
    email.sendChangelogPublishedEmail({
      to,
      changelogTitle: 'May release',
      changelogUrl: 'https://acme.test/changelog',
      contentPreview: 'New things',
      workspaceName: w!,
      ...extra,
      unsubscribeUrl: 'https://acme.test/u',
    }),
  sendStatusIncidentPublishedEmail: (w, extra) =>
    email.sendStatusIncidentPublishedEmail({
      to,
      workspaceName: w!,
      ...extra,
      incidentTitle: 'API errors',
      impact: 'minor',
      statusLabel: 'Investigating',
      body: 'Looking into it',
      affectedComponents: [],
      incidentUrl: 'https://acme.test/status/1',
      unsubscribeUrl: 'https://acme.test/u',
    }),
  sendStatusMaintenanceScheduledEmail: (w, extra) =>
    email.sendStatusMaintenanceScheduledEmail({
      to,
      workspaceName: w!,
      ...extra,
      maintenanceTitle: 'Database upgrade',
      body: 'Short window',
      startLabel: 'start',
      endLabel: 'end',
      affectedComponents: [],
      incidentUrl: 'https://acme.test/status/2',
      unsubscribeUrl: 'https://acme.test/u',
    }),
  sendCsatRequestEmail: (w, extra) =>
    email.sendCsatRequestEmail({
      to,
      promptText: 'How did we do?',
      ratingUrls,
      workspaceName: w!,
      ...extra,
    }),
}

/** Mail about Quackback itself, named for the product rather than the workspace. */
const aboutQuackbackSenders: Record<string, Drive> = {
  sendOnboardingWelcomeEmail: (w) =>
    email.sendOnboardingWelcomeEmail({ to, workspaceName: w!, ...onboardingContent }),
  sendOnboardingNudgeEmail: (w) =>
    email.sendOnboardingNudgeEmail({ to, workspaceName: w!, ...onboardingContent }),
  sendSendingDomainAttentionEmail: (w) =>
    email.sendSendingDomainAttentionEmail({ to, domain: 'acme.test', workspaceName: w }),
  sendDomainAttentionEmail: (w) =>
    email.sendDomainAttentionEmail({
      to,
      domain: 'acme.test',
      record: { name: '_quackback.acme.test', value: 'quackback-domain-verification=abc' },
      workspaceName: w,
    }),
}

/** Senders that never use the platform address: the caller must name one. */
const ownAddressOnly = new Set(['sendRawEmail'])

function sentFrom(): string {
  expect(resendSend).toHaveBeenCalledTimes(1)
  return resendSend.mock.calls[0][0].from as string
}

describe('every exported sender is covered', () => {
  it('has a case for each send*Email export', () => {
    const exported = Object.keys(email)
      .filter((k) => /^send\w*Email$/.test(k))
      .sort()
    const covered = [
      ...Object.keys(workspaceSenders),
      ...Object.keys(aboutQuackbackSenders),
      ...ownAddressOnly,
    ].sort()
    expect(covered).toEqual(exported)
  })
})

describe('platform mail for a workspace with a name (registry From installed)', () => {
  beforeEach(() => {
    email.setDefaultFromResolver(() => REGISTRY_FROM)
  })

  it.each(Object.entries(workspaceSenders))(
    '%s goes from the platform address under the workspace name',
    async (_name, send) => {
      await send('Acme Widgets')
      const from = sentFrom()
      expect(from).not.toContain('Quackback Cloud')
      expect(from).toBe(`Acme Widgets <${PLATFORM_ADDRESS}>`)
    }
  )

  it.each(Object.entries(aboutQuackbackSenders))(
    '%s goes from the platform address named Quackback',
    async (_name, send) => {
      await send('Acme Widgets')
      expect(sentFrom()).toBe(`Quackback <${PLATFORM_ADDRESS}>`)
    }
  )

  it('keeps a name the caller chose for the platform address', async () => {
    await email.sendConversationMessageEmail({
      to,
      direction: 'agent_reply',
      senderName: 'Sam',
      messagePreview: 'Hi',
      ctaUrl: 'https://acme.test/p',
      workspaceName: 'Acme Widgets',
      fromDisplayName: 'Sam at Acme Widgets',
    })
    expect(sentFrom()).toBe(`Sam at Acme Widgets <${PLATFORM_ADDRESS}>`)
  })

  it('quotes a workspace name that would otherwise break the header', async () => {
    await email.sendPasswordResetEmail({
      to,
      resetLink: 'https://acme.test/reset',
      workspaceName: 'Acme, Inc.',
    })
    expect(sentFrom()).toBe(`"Acme, Inc." <${PLATFORM_ADDRESS}>`)
  })
})

/**
 * Senders whose callers used to pass `fromDisplayName: workspaceName` whenever
 * they had no address of their own. The shared send point names the platform
 * address for the workspace already, so that line changed nothing, and this
 * keeps it that way now that the callers leave it out.
 */
const NAMED_BY_CALLERS = [
  'sendCsatRequestEmail',
  'sendConversationAutoAckEmail',
  'sendConversationClosedEmail',
  'sendStatusChangeEmail',
  'sendNewCommentEmail',
  'sendPostMentionEmail',
  'sendChangelogPublishedEmail',
  'sendStatusIncidentPublishedEmail',
  'sendStatusMaintenanceScheduledEmail',
  'sendTicketEventEmail',
] as const

describe('naming the platform address for the workspace by hand', () => {
  beforeEach(() => {
    email.setDefaultFromResolver(() => REGISTRY_FROM)
  })

  it.each(NAMED_BY_CALLERS)('%s goes out the same with or without it', async (name) => {
    const send = workspaceSenders[name]
    await send('Acme Widgets')
    const unnamed = sentFrom()
    resendSend.mockClear()
    await send('Acme Widgets', { fromDisplayName: 'Acme Widgets' })
    expect(sentFrom()).toBe(unnamed)
    expect(unnamed).toBe(`Acme Widgets <${PLATFORM_ADDRESS}>`)
  })
})

describe('an install with no workspace name (self-hosted EMAIL_FROM)', () => {
  beforeEach(() => {
    process.env.EMAIL_FROM = 'Acme Support <support@acme.test>'
  })

  it.each(Object.entries(workspaceSenders))(
    "%s keeps the operator's EMAIL_FROM name",
    async (_name, send) => {
      await send(undefined)
      expect(sentFrom()).toBe('Acme Support <support@acme.test>')
    }
  )

  it('treats a blank workspace name as no name', async () => {
    await email.sendPasswordResetEmail({ to, resetLink: 'https://x.test', workspaceName: '   ' })
    expect(sentFrom()).toBe('Acme Support <support@acme.test>')
  })

  it.each(Object.entries(workspaceSenders))(
    "%s keeps the operator's EMAIL_FROM name over the workspace name",
    async (_name, send) => {
      await send('Acme Widgets')
      expect(sentFrom()).toBe('Acme Support <support@acme.test>')
    }
  )

  it('still names an agent reply after the agent', () => {
    expect(
      platformDisplayName('ConversationReplyEmail', 'Acme', {
        operatorNamed: true,
        callerName: 'Alex from Acme',
      })
    ).toBe('Alex from Acme')
  })
})

describe('a shared server with no From for the workspace in scope', () => {
  // The platform's own EMAIL_FROM is not an operator speaking for one
  // workspace, so its name must not reach that workspace's people.
  beforeEach(() => {
    process.env.EMAIL_FROM = REGISTRY_FROM
    email.setDefaultFromShared(() => true)
  })

  it('still names the workspace over the platform', async () => {
    await email.sendPasswordResetEmail({ to, resetLink: 'https://x.test', workspaceName: 'Acme' })
    expect(sentFrom()).toBe(`Acme <${PLATFORM_ADDRESS}>`)
  })

  it('previews the same From for a settings page', () => {
    expect(email.platformFromPreview('Acme')).toBe(`Acme <${PLATFORM_ADDRESS}>`)
  })
})

describe('the From a settings page shows for the platform address', () => {
  it("keeps the operator's own name, as the send does", () => {
    process.env.EMAIL_FROM = 'Acme Support <support@acme.test>'
    expect(email.platformFromPreview('Acme Widgets')).toBe('Acme Support <support@acme.test>')
  })

  it('names a bare address for the workspace, and leaves it bare with no name', () => {
    process.env.EMAIL_FROM = 'support@acme.test'
    expect(email.platformFromPreview('Acme')).toBe('Acme <support@acme.test>')
    expect(email.platformFromPreview('  ')).toBe('support@acme.test')
  })

  it('shows an encoded or quoted name the way an inbox does', () => {
    process.env.EMAIL_FROM = '"Acme, Inc" <support@acme.test>'
    expect(email.platformFromPreview(null)).toBe('Acme, Inc <support@acme.test>')
  })

  it('is null when no address is configured', () => {
    expect(email.platformFromPreview('Acme')).toBeNull()
  })

  it('names the workspace on the registry From', () => {
    email.setDefaultFromResolver(() => REGISTRY_FROM)
    expect(email.platformFromPreview('Acme')).toBe(`Acme <${PLATFORM_ADDRESS}>`)
  })
})

describe('an install whose EMAIL_FROM is a bare address', () => {
  beforeEach(() => {
    process.env.EMAIL_FROM = 'support@acme.test'
  })

  it('names the workspace', async () => {
    await email.sendPasswordResetEmail({ to, resetLink: 'https://x.test', workspaceName: 'Acme' })
    expect(sentFrom()).toBe('Acme <support@acme.test>')
  })
})

describe('platformDisplayName', () => {
  it('names mail about the product Quackback whatever the workspace', () => {
    expect(platformDisplayName('OnboardingWelcomeEmail', 'Acme')).toBe('Quackback')
    expect(platformDisplayName('SendingDomainAttentionEmail', undefined)).toBe('Quackback')
    expect(platformDisplayName('DomainAttentionEmail', 'Acme')).toBe('Quackback')
  })

  it('names everything else for the workspace, or nothing without one', () => {
    expect(platformDisplayName('PasswordResetEmail', ' Acme ')).toBe('Acme')
    expect(platformDisplayName('PasswordResetEmail', '')).toBeUndefined()
    expect(platformDisplayName('PasswordResetEmail', null)).toBeUndefined()
  })
})
