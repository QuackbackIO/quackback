import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the email package before importing the handler
vi.mock('@quackback/email', () => ({
  sendStatusChangeEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
  sendChangelogPublishedEmail: vi.fn(),
  sendPostMentionEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendTicketEventEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendNoteMentionEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

/**
 * The sending-identity guard, re-asked at SEND time.
 *
 * The target builder resolved a From when the event was enqueued; this hook
 * runs after the queue, which can be minutes later and is certainly after a
 * scheduled re-check could have un-verified the domain. Mocked here so this
 * suite can pin THAT the guard runs and that its answer is what goes out — the
 * rule it applies has its own tests.
 */
const permittedSendingIdentity = vi.fn<(from: string | null) => Promise<string | null>>(
  async (from) => from
)
vi.mock('@/lib/server/domains/channel-accounts/outbound-identity', () => ({
  permittedSendingIdentity: (from: string | null) => permittedSendingIdentity(from),
}))

// Threading helpers are pure but read env-derived domains; force a known domain
// so the created-root Message-ID assertion is deterministic.
vi.stubEnv('EMAIL_FROM', 'Support <support@acme.test>')

import { emailHook } from '../handlers/email'
// The real error class, from the transport module rather than the mocked
// package entry: a hand-written stand-in for it stops tracking the shape the
// moment the shape changes, which is how the classification regression this
// guards against went unnoticed.
import { SesEmailError } from '@quackback/email/ses'
import {
  sendStatusChangeEmail,
  sendNewCommentEmail,
  sendChangelogPublishedEmail,
  sendPostMentionEmail,
  sendTicketEventEmail,
  sendNoteMentionEmail,
} from '@quackback/email'
import type {
  EmailTarget,
  EmailConfig,
  TicketEmailConfig,
  NoteMentionEmailConfig,
} from '../hook-types'
import type { EventData } from '../types'

const mockStatusChangeEmail = vi.mocked(sendStatusChangeEmail)
const mockNewCommentEmail = vi.mocked(sendNewCommentEmail)
const mockChangelogPublishedEmail = vi.mocked(sendChangelogPublishedEmail)
const mockPostMentionEmail = vi.mocked(sendPostMentionEmail)
const mockTicketEventEmail = vi.mocked(sendTicketEventEmail)
const mockNoteMentionEmail = vi.mocked(sendNoteMentionEmail)

// The email handler only reads event.type, so data is irrelevant for these tests
const statusChangedEvent = {
  id: 'evt-test',
  type: 'post.status_changed',
  timestamp: new Date().toISOString(),
  actor: { type: 'user', displayName: 'Test User' },
} as EventData

const commentCreatedEvent = {
  id: 'evt-test',
  type: 'comment.created',
  timestamp: new Date().toISOString(),
  actor: { type: 'user', displayName: 'Test User' },
} as EventData

const postCreatedEvent = {
  id: 'evt-test',
  type: 'post.created',
  timestamp: new Date().toISOString(),
  actor: { type: 'user', displayName: 'Test User' },
} as EventData

const baseTarget: EmailTarget = {
  // The delivery handler receives an address that was already resolved at
  // construction; the brand does not survive the outbox's JSON round trip, so
  // a fixture asserts it the same way the handler does.
  email: 'user@example.com' as EmailTarget['email'],
  unsubscribeUrl: 'https://example.com/unsubscribe',
}

const baseConfig = {
  workspaceName: 'TestWorkspace',
  postUrl: 'https://example.com/post/1',
  postTitle: 'Test Post',
  logoUrl: 'https://example.com/logo.png',
} satisfies EmailConfig

describe('emailHook', () => {
  describe('when email is configured (sent: true)', () => {
    it('sends status change email and returns success', async () => {
      mockStatusChangeEmail.mockResolvedValue({ sent: true })

      const result = await emailHook.run(statusChangedEvent, baseTarget, {
        ...baseConfig,
        previousStatus: 'open',
        newStatus: 'in_progress',
      })

      expect(result).toEqual({ success: true })
      expect(mockStatusChangeEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        postTitle: 'Test Post',
        postUrl: 'https://example.com/post/1',
        previousStatus: 'open',
        newStatus: 'in_progress',
        workspaceName: 'TestWorkspace',
        unsubscribeUrl: 'https://example.com/unsubscribe',
        logoUrl: 'https://example.com/logo.png',
      })
    })

    it('sends new comment email and returns success', async () => {
      mockNewCommentEmail.mockResolvedValue({ sent: true })

      const result = await emailHook.run(commentCreatedEvent, baseTarget, {
        ...baseConfig,
        commenterName: 'Commenter',
        commentPreview: 'Hello',
        isTeamMember: true,
      })

      expect(result).toEqual({ success: true })
      expect(mockNewCommentEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        postTitle: 'Test Post',
        postUrl: 'https://example.com/post/1',
        commenterName: 'Commenter',
        commentPreview: 'Hello',
        isTeamMember: true,
        workspaceName: 'TestWorkspace',
        unsubscribeUrl: 'https://example.com/unsubscribe',
        logoUrl: 'https://example.com/logo.png',
      })
    })
    it('sends changelog published email with the full rendered body and returns success', async () => {
      mockChangelogPublishedEmail.mockResolvedValue({ sent: true })
      const changelogPublishedEvent = {
        id: 'evt-test',
        type: 'changelog.published',
        timestamp: new Date().toISOString(),
        actor: { type: 'user', displayName: 'Test User' },
      } as EventData

      const result = await emailHook.run(changelogPublishedEvent, baseTarget, {
        workspaceName: 'TestWorkspace',
        logoUrl: 'https://example.com/logo.png',
        changelogTitle: 'May Release',
        changelogUrl: 'https://example.com/changelog/changelog_01',
        contentPreview: 'short preview',
        contentHtml: '<p>Intro</p><p><img src="https://example.com/x.png" alt="Shot" /></p>',
      })

      expect(result).toEqual({ success: true })
      expect(mockChangelogPublishedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          changelogTitle: 'May Release',
          changelogUrl: 'https://example.com/changelog/changelog_01',
          contentPreview: 'short preview',
          contentHtml: '<p>Intro</p><p><img src="https://example.com/x.png" alt="Shot" /></p>',
        })
      )
    })
  })

  describe('when email is not configured (sent: false)', () => {
    it('returns success without error for status change', async () => {
      mockStatusChangeEmail.mockResolvedValue({ sent: false })

      const result = await emailHook.run(statusChangedEvent, baseTarget, {
        ...baseConfig,
        previousStatus: 'open',
        newStatus: 'closed',
      })

      expect(result).toEqual({ success: true })
      expect(result.shouldRetry).toBeUndefined()
    })

    it('returns success without error for new comment', async () => {
      mockNewCommentEmail.mockResolvedValue({ sent: false })

      const result = await emailHook.run(commentCreatedEvent, baseTarget, {
        ...baseConfig,
        commenterName: 'Commenter',
        commentPreview: 'Hi',
      })

      expect(result).toEqual({ success: true })
      expect(result.shouldRetry).toBeUndefined()
    })
  })

  describe('error handling', () => {
    /**
     * The error the transport really throws, not an approximation of it. A
     * connection that is refused reaches the send path already wrapped: the
     * socket code survives on `code`, there is no HTTP status, and the wrapper
     * declares itself retryable. This hook reads `code`, so a transport that
     * dropped it in favour of the SDK's generic error name would make a network
     * blip look like a permanent failure and kill the job.
     */
    it('returns failure with shouldRetry for network errors', async () => {
      const error = new SesEmailError(
        'SES email send failed: connect ECONNREFUSED 127.0.0.1:443',
        null,
        'ECONNREFUSED',
        true
      )
      mockStatusChangeEmail.mockRejectedValue(error)

      const result = await emailHook.run(statusChangedEvent, baseTarget, {
        ...baseConfig,
        previousStatus: 'open',
        newStatus: 'closed',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('SES email send failed: connect ECONNREFUSED 127.0.0.1:443')
      expect(result.shouldRetry).toBe(true)
    })

    /**
     * The same failure as it arrives if the transport keeps only the SDK's
     * error name. Nothing downstream can tell this from a rejected message, so
     * the job dies on the first blip — which is what this hook must never do
     * with a recoverable one.
     */
    it('would not retry the same failure stripped of its socket code', async () => {
      mockStatusChangeEmail.mockRejectedValue(
        new SesEmailError('SES email send failed: connect ECONNREFUSED', null, 'Error', false)
      )

      const result = await emailHook.run(statusChangedEvent, baseTarget, {
        ...baseConfig,
        previousStatus: 'open',
        newStatus: 'closed',
      })

      expect(result.shouldRetry).toBe(false)
    })

    it('returns failure without retry for non-retryable errors', async () => {
      mockNewCommentEmail.mockRejectedValue(new Error('Invalid template'))

      const result = await emailHook.run(commentCreatedEvent, baseTarget, {
        ...baseConfig,
        commenterName: 'X',
        commentPreview: 'Y',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid template')
      expect(result.shouldRetry).toBe(false)
    })
  })

  it('returns failure for unsupported event types', async () => {
    const result = await emailHook.run(postCreatedEvent, baseTarget, baseConfig)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported event type')
  })
})

describe('emailHook — post.mentioned', () => {
  const mentionData = {
    postId: 'post_123',
    postTitle: 'Why we should add dark mode',
    postUrl: 'https://example.com/p/123',
    mentionedPrincipalId: 'principal_target',
    mentioningPrincipalId: 'principal_actor',
    excerpt: 'Hey @alice, what do you think?',
  }

  it('calls sendPostMentionEmail with the actor displayName when present', async () => {
    mockPostMentionEmail.mockClear()
    mockPostMentionEmail.mockResolvedValue({ sent: true })

    const event = {
      id: 'evt-mention-1',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', displayName: 'Alex' },
      data: mentionData,
    } as unknown as EventData

    const result = await emailHook.run(event, baseTarget, baseConfig)

    expect(result).toEqual({ success: true })
    expect(mockPostMentionEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      mentionerName: 'Alex',
      postTitle: 'Why we should add dark mode',
      excerpt: 'Hey @alice, what do you think?',
      postUrl: 'https://example.com/p/123',
      workspaceName: 'TestWorkspace',
      unsubscribeUrl: 'https://example.com/unsubscribe',
      logoUrl: 'https://example.com/logo.png',
    })
  })

  it('falls back to empty mentionerName when actor has no displayName', async () => {
    mockPostMentionEmail.mockClear()
    mockPostMentionEmail.mockResolvedValue({ sent: true })

    const event = {
      id: 'evt-mention-2',
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'anonymous' },
      data: mentionData,
    } as unknown as EventData

    const result = await emailHook.run(event, baseTarget, baseConfig)

    expect(result).toEqual({ success: true })
    expect(mockPostMentionEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionerName: '',
        excerpt: 'Hey @alice, what do you think?',
      })
    )
  })
})

describe('emailHook — ticket + SLA lifecycle', () => {
  const evt = (type: string): EventData =>
    ({
      id: 'evt-t',
      type,
      timestamp: new Date().toISOString(),
      actor: { type: 'user' },
    }) as EventData

  const ticketConfig = (
    over: Partial<TicketEmailConfig>
  ): TicketEmailConfig & Record<string, unknown> => ({
    kind: 'created',
    workspaceName: 'Acme',
    ticketLabel: '#1',
    title: 'Cannot log in',
    ticketId: 'ticket_1',
    ctaUrl: 'https://p/support/ticket/ticket_1',
    ...over,
  })

  beforeEach(() => {
    mockTicketEventEmail.mockClear()
    mockTicketEventEmail.mockResolvedValue({ sent: true })
    permittedSendingIdentity.mockReset().mockImplementation(async (from) => from)
  })

  it.each([
    ['ticket.created', 'created'],
    ['ticket.replied', 'reply'],
    ['ticket.status_changed', 'status_resolved'],
    ['ticket.assigned', 'assigned'],
    ['sla.approaching_breach', 'sla_warning'],
    ['sla.breached', 'sla_breach'],
  ] as const)('routes %s → sendTicketEventEmail(kind=%s)', async (type, kind) => {
    const config = kind.startsWith('sla')
      ? ticketConfig({
          kind,
          ticketId: undefined,
          ctaUrl: 'https://p/admin/inbox?i=conversation_1',
        })
      : ticketConfig({ kind })
    const result = await emailHook.run(evt(type), baseTarget, config)
    expect(result).toEqual({ success: true })
    expect(mockTicketEventEmail).toHaveBeenCalledTimes(1)
    expect(mockTicketEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', kind, ctaUrl: config.ctaUrl })
    )
  })

  it('created email carries the deterministic ticket root id as its own Message-ID', async () => {
    await emailHook.run(evt('ticket.created'), baseTarget, ticketConfig({ kind: 'created' }))
    expect(mockTicketEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'ticket-1@acme.test',
        inReplyTo: undefined,
        references: undefined,
      })
    )
  })

  it('a later ticket email mints a fresh Message-ID and References the root', async () => {
    await emailHook.run(evt('ticket.replied'), baseTarget, ticketConfig({ kind: 'reply' }))
    const args = mockTicketEventEmail.mock.calls[0][0]
    expect(args.messageId).toMatch(/^ticket-1\..+@acme\.test$/)
    expect(args.inReplyTo).toBe('ticket-1@acme.test')
    expect(args.references).toEqual(['ticket-1@acme.test'])
  })

  it('an SLA email (no ticket id) threads on nothing', async () => {
    await emailHook.run(
      evt('sla.breached'),
      baseTarget,
      ticketConfig({ kind: 'sla_breach', ticketId: undefined })
    )
    const args = mockTicketEventEmail.mock.calls[0][0]
    expect(args.messageId).toBeUndefined()
    expect(args.inReplyTo).toBeUndefined()
    expect(args.references).toBeUndefined()
  })

  it('re-asks the guard at send time, and sends as the answer it gives', async () => {
    // Not the address the payload carried. Between enqueue and send, a domain
    // can stop being verified — the scheduled re-check demotes one whose
    // records have gone — and the send is the moment the claim is made.
    permittedSendingIdentity.mockResolvedValue('support@tenant-a.example')
    await emailHook.run(
      evt('ticket.created'),
      baseTarget,
      ticketConfig({ kind: 'created', from: 'stale@tenant-a.example' })
    )
    expect(permittedSendingIdentity).toHaveBeenCalledWith('stale@tenant-a.example')
    expect(mockTicketEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'support@tenant-a.example' })
    )
  })

  it('falls back to the platform sender when the guard refuses', async () => {
    // A refusal is a fallback, not a dropped mail: the message still goes, from
    // an address that is honestly ours.
    permittedSendingIdentity.mockResolvedValue(null)
    await emailHook.run(
      evt('ticket.created'),
      baseTarget,
      ticketConfig({ kind: 'created', from: 'support@tenant-a.example' })
    )
    expect(mockTicketEventEmail).toHaveBeenCalledWith(expect.objectContaining({ from: undefined }))
  })

  it('still rejects a genuinely unsupported type', async () => {
    const result = await emailHook.run(
      { id: 'x', type: 'post.created', timestamp: '', actor: { type: 'user' } } as EventData,
      baseTarget,
      baseConfig
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported event type')
  })
})

describe('emailHook — conversation.note_mentioned', () => {
  const noteMentionedEvent = {
    id: 'evt-note-mention',
    type: 'conversation.note_mentioned',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', principalId: 'principal_author', displayName: 'Jane' },
    data: {
      conversationId: 'conversation_1',
      conversationMessageId: 'conversation_msg_1',
      mentionedPrincipalIds: ['principal_one'],
      authorName: 'Jane',
      preview: 'can you take a look at the refund policy here?',
    },
  } as unknown as EventData

  const noteMentionConfig: NoteMentionEmailConfig & Record<string, unknown> = {
    workspaceName: 'Acme Support',
    conversationId: 'conversation_1',
    authorName: 'Jane',
    preview: 'can you take a look at the refund policy here?',
    ctaUrl: 'https://w.example/admin/inbox?i=conversation_1',
    preferencesUrl: 'https://w.example/settings/preferences',
  }

  beforeEach(() => {
    mockNoteMentionEmail.mockClear()
    mockNoteMentionEmail.mockResolvedValue({ sent: true })
  })

  it('sends the note-mention alert with the author, preview and inbox link', async () => {
    const result = await emailHook.run(noteMentionedEvent, baseTarget, noteMentionConfig)

    expect(result).toEqual({ success: true })
    expect(mockNoteMentionEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        authorName: 'Jane',
        preview: 'can you take a look at the refund policy here?',
        conversationUrl: 'https://w.example/admin/inbox?i=conversation_1',
        workspaceName: 'Acme Support',
        preferencesUrl: 'https://w.example/settings/preferences',
        logoUrl: undefined,
      })
    )
  })

  it('mints a fresh Message-ID and References the conversation note-thread root', async () => {
    await emailHook.run(noteMentionedEvent, baseTarget, noteMentionConfig)
    const args = mockNoteMentionEmail.mock.calls[0][0]
    expect(args.messageId).toMatch(/^note\.1\..+@acme\.test$/)
    expect(args.inReplyTo).toBe('note.1@acme.test')
    expect(args.references).toEqual(['note.1@acme.test'])
  })

  it('threads every alert on one conversation together while keeping ids unique', async () => {
    await emailHook.run(noteMentionedEvent, baseTarget, noteMentionConfig)
    await emailHook.run(noteMentionedEvent, baseTarget, noteMentionConfig)
    const [first, second] = mockNoteMentionEmail.mock.calls.map((c) => c[0])
    expect(first.messageId).not.toBe(second.messageId)
    expect(first.references).toEqual(second.references)
  })

  it('threads on nothing when the config carries no conversation id', async () => {
    await emailHook.run(noteMentionedEvent, baseTarget, {
      ...noteMentionConfig,
      conversationId: '',
    })
    const args = mockNoteMentionEmail.mock.calls[0][0]
    expect(args.messageId).toBeUndefined()
    expect(args.inReplyTo).toBeUndefined()
    expect(args.references).toBeUndefined()
  })

  it('reports success without sending when email is not configured', async () => {
    mockNoteMentionEmail.mockResolvedValue({ sent: false })
    expect(await emailHook.run(noteMentionedEvent, baseTarget, noteMentionConfig)).toEqual({
      success: true,
    })
  })
})
