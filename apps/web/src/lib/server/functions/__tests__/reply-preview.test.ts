/**
 * The reply preview read behind the widget's card above the closed launcher:
 * widget sessions only, nothing when conversations are off or nothing is
 * unread, plain text from the newest unread replies, and the newest reply's
 * author, shown as the team alone when it reads as the team.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let handler: (() => Promise<unknown>) | null = null
    const fn = () => {
      if (!handler) throw new Error('handler not registered')
      return handler()
    }
    fn.validator = () => fn
    fn.handler = (h: () => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  isConversationsEnabled: vi.fn(),
  listVisitorUnreadReplies: vi.fn(),
  loadAuthors: vi.fn(),
  getSupportTeamName: vi.fn(),
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.log, child })
  return { logger: { ...hoisted.log, child }, createLogger: () => ({ ...hoisted.log, child }) }
})
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
  requireAuth: vi.fn(),
  assertPermission: vi.fn(),
  policyActorFromAuth: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: hoisted.isConversationsEnabled,
  isConversationsEnabledFor: () => hoisted.isConversationsEnabled(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listVisitorUnreadReplies: hoisted.listVisitorUnreadReplies,
}))
vi.mock('@/lib/server/domains/principals/principal-display', () => ({
  loadAuthors: hoisted.loadAuthors,
  getSupportTeamName: hoisted.getSupportTeamName,
}))

import { runGetReplyPreview } from '../conversation'

const widgetCtx = { principal: { id: 'principal_v', role: 'user' }, scope: 'widget' } as never

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.isConversationsEnabled.mockResolvedValue(true)
  hoisted.getSupportTeamName.mockResolvedValue('Acme')
  hoisted.loadAuthors.mockResolvedValue(
    new Map([
      [
        'principal_alex',
        {
          principalId: 'principal_alex',
          displayName: 'Alex Kim',
          avatarUrl: 'https://cdn.example.com/a.png',
        },
      ],
    ])
  )
  hoisted.listVisitorUnreadReplies.mockResolvedValue({
    conversationId: 'conversation_1',
    count: 4,
    messages: [
      {
        id: 'conversation_msg_1',
        content: '**Thanks** for waiting',
        createdAt: new Date('2026-11-20T10:00:00.000Z'),
        principalId: 'principal_alex',
      },
      {
        id: 'conversation_msg_2',
        content: '<p>It is fixed now</p>',
        createdAt: new Date('2026-11-20T10:01:00.000Z'),
        principalId: 'principal_alex',
      },
    ],
  })
})

describe('runGetReplyPreview', () => {
  it('reads nothing without a widget session', async () => {
    expect(await runGetReplyPreview(null)).toBeNull()
    expect(
      await runGetReplyPreview({ principal: { id: 'principal_v', role: 'user' } } as never)
    ).toBeNull()
    expect(hoisted.listVisitorUnreadReplies).not.toHaveBeenCalled()
  })

  it('reads nothing when conversations are off', async () => {
    hoisted.isConversationsEnabled.mockResolvedValue(false)
    expect(await runGetReplyPreview(widgetCtx)).toBeNull()
    expect(hoisted.listVisitorUnreadReplies).not.toHaveBeenCalled()
  })

  it('is null when nothing is unread', async () => {
    hoisted.listVisitorUnreadReplies.mockResolvedValue(null)
    expect(await runGetReplyPreview(widgetCtx)).toBeNull()
  })

  it('returns plain text, the count and the newest reply author', async () => {
    expect(await runGetReplyPreview(widgetCtx)).toEqual({
      conversationId: 'conversation_1',
      author: { name: 'Alex Kim', avatarUrl: 'https://cdn.example.com/a.png' },
      teamName: 'Acme',
      count: 4,
      messages: [
        {
          id: 'conversation_msg_1',
          text: 'Thanks for waiting',
          createdAt: '2026-11-20T10:00:00.000Z',
        },
        {
          id: 'conversation_msg_2',
          text: 'It is fixed now',
          createdAt: '2026-11-20T10:01:00.000Z',
        },
      ],
    })
    expect(hoisted.listVisitorUnreadReplies).toHaveBeenCalledWith('principal_v', 3)
    expect(hoisted.loadAuthors).toHaveBeenCalledWith(['principal_alex'], { forCustomer: true })
  })

  it('shows a reply that reads as the team as the team alone', async () => {
    hoisted.loadAuthors.mockResolvedValue(
      new Map([
        ['principal_alex', { principalId: 'principal_alex', displayName: 'Acme', avatarUrl: null }],
      ])
    )
    const preview = await runGetReplyPreview(widgetCtx)
    expect(preview?.author).toEqual({ name: null, avatarUrl: null })
  })

  it('caps a long reply between code points', async () => {
    hoisted.listVisitorUnreadReplies.mockResolvedValue({
      conversationId: 'conversation_1',
      count: 1,
      messages: [
        {
          id: 'conversation_msg_1',
          content: 'a'.repeat(1999) + '\u{1F680}' + 'tail',
          createdAt: new Date('2026-11-20T10:00:00.000Z'),
          principalId: null,
        },
      ],
    })
    const preview = await runGetReplyPreview(widgetCtx)
    expect(Array.from(preview!.messages[0].text)).toHaveLength(2000)
    expect(preview!.messages[0].text.endsWith('\u{1F680}')).toBe(true)
    expect(preview!.author).toEqual({ name: null, avatarUrl: null })
  })
})
