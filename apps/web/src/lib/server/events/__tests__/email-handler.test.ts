import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the email package before importing the handler
vi.mock('@quackback/email', () => ({
  sendStatusChangeEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
  sendChangelogPublishedEmail: vi.fn(),
  sendPostMentionEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendTicketEventEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

// Threading helpers are pure but read env-derived domains; force a known domain
// so the created-root Message-ID assertion is deterministic.
vi.stubEnv('EMAIL_FROM', 'Support <support@acme.test>')

import { emailHook } from '../handlers/email'
import {
  sendStatusChangeEmail,
  sendNewCommentEmail,
  sendPostMentionEmail,
  sendTicketEventEmail,
} from '@quackback/email'
import type { EmailTarget, EmailConfig, TicketEmailConfig } from '../hook-types'
import type { EventData } from '../types'

const mockStatusChangeEmail = vi.mocked(sendStatusChangeEmail)
const mockNewCommentEmail = vi.mocked(sendNewCommentEmail)
const mockPostMentionEmail = vi.mocked(sendPostMentionEmail)
const mockTicketEventEmail = vi.mocked(sendTicketEventEmail)

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
  email: 'user@example.com',
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
    it('returns failure with shouldRetry for network errors', async () => {
      const error = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      mockStatusChangeEmail.mockRejectedValue(error)

      const result = await emailHook.run(statusChangedEvent, baseTarget, {
        ...baseConfig,
        previousStatus: 'open',
        newStatus: 'closed',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
      expect(result.shouldRetry).toBe(true)
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
